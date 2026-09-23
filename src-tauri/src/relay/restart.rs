//! RelayDesk 目标工具重启：能力检测、重启资格票据与状态机。
//!
//! 安全边界：
//! - 可终止身份仅来自编译期 allowlist。`ChatGPT.app`/`Codex.app` 的
//!   bundle identifier `com.openai.codex` 已在真实安装包上验证
//!   （`/Applications/ChatGPT.app/Contents/Info.plist` 与 `codesign -dv`
//!   的 Identifier 一致）；远程 tool_registry 只能更新显示信息或把
//!   `readsCliConfig` 降级，不能新增/授权可终止目标。
//! - renderer 只回传 `app`、后端签发的 `targetId` 与 `operationId`，
//!   绝不接受路径、PID、bundle id 或 shell 命令。
//! - 重启资格由后端在模型应用成功时签发短期票据，restart 命令校验后才执行。
//! - 只请求正常退出（`NSRunningApplication terminate`，等价 Cmd+Q），
//!   退出超时返回 `exit_timeout`，绝不默认强杀；`open <appRoot>` 重新拉起
//!   同一个已验证 bundle，不用启动第二实例冒充重启。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::tool_registry::ToolRegistry;

/// 重启资格票据有效期：覆盖“应用成功 → 用户查看 → 确认重启”的完整交互窗口。
const TICKET_TTL: Duration = Duration::from_secs(15 * 60);
/// 进度事件名（renderer 侧 `listen("relay-restart-progress")`）。
pub(crate) const RESTART_PROGRESS_EVENT: &str = "relay-restart-progress";

// ── DTO ──────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayRestartCapability {
    pub app: String,
    pub supported: bool,
    pub installed: bool,
    /// None = 无法安全判断（CLI 会话不做进程归属判定）。
    pub running: Option<bool>,
    pub target_kind: &'static str,
    /// 后端生成的稳定身份；renderer 只能原样回传，不能构造路径/PID。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub reads_cli_config: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayRestartResult {
    pub app: String,
    pub target_id: String,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub exited_existing_process: bool,
    pub started_new_process: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayRestartProgress {
    pub operation_id: String,
    pub app: String,
    pub stage: String,
}

// ── 本地受信任身份表（编译期 allowlist）─────────────────────────────────

/// 允许被正常退出并重启的桌面目标。bundle id 只能来自这里，不能来自远程注册表。
#[derive(Clone, Debug)]
pub(crate) struct TrustedDesktopIdentity {
    pub app: String,
    pub app_name: String,
    pub bundle_id: String,
    pub display_name: String,
    pub reads_cli_config: bool,
    /// 仅 debug 注入使用的额外搜索目录（生产身份为空）。
    pub extra_roots: Vec<PathBuf>,
}

fn builtin_trusted_identities() -> Vec<TrustedDesktopIdentity> {
    vec![
        // Claude.app —— bundle id 依据真实安装包 v2.2553.1：
        //   CFBundleIdentifier = com.anthropic.claudefordesktop
        //   codesign Identifier 一致，TeamIdentifier Q6L2SF6YDW。
        // 其内嵌 Claude Code 会话以 settingSources:["user"] 启动，
        // 消费 ~/.claude/settings.json——重启对桌面 code 会话是真重启。
        TrustedDesktopIdentity {
            app: "claude".into(),
            app_name: "Claude.app".into(),
            bundle_id: "com.anthropic.claudefordesktop".into(),
            display_name: "Claude".into(),
            reads_cli_config: true,
            extra_roots: vec![],
        },
        TrustedDesktopIdentity {
            app: "codex".into(),
            app_name: "ChatGPT.app".into(),
            bundle_id: "com.openai.codex".into(),
            display_name: "ChatGPT (Codex)".into(),
            reads_cli_config: true,
            extra_roots: vec![],
        },
        // Codex.app 为旧名兼容候选，与 ChatGPT.app 同属 com.openai.codex。
        TrustedDesktopIdentity {
            app: "codex".into(),
            app_name: "Codex.app".into(),
            bundle_id: "com.openai.codex".into(),
            display_name: "Codex (legacy name)".into(),
            reads_cli_config: true,
            extra_roots: vec![],
        },
    ]
}

/// debug 构建专用注入通道：隔离测试环境可通过
/// `RELAYDESK_RESTART_DEBUG_IDENTITIES`（JSON 数组）整体替换受信任身份表，
/// 用于在真实 macOS 上用测试 App 验收退出/启动链路。
/// 设置后内置身份不再参与——避免验收过程碰到真实安装的 Codex/ChatGPT。
/// release 构建不编译此函数——注入通道在生产包中不存在。
#[cfg(debug_assertions)]
fn debug_identities() -> Option<Vec<TrustedDesktopIdentity>> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DebugIdentity {
        app: String,
        app_name: String,
        bundle_id: String,
        display_name: String,
        #[serde(default)]
        reads_cli_config: bool,
        #[serde(default)]
        extra_roots: Vec<PathBuf>,
    }
    let raw = std::env::var("RELAYDESK_RESTART_DEBUG_IDENTITIES").ok()?;
    let entries = serde_json::from_str::<Vec<DebugIdentity>>(&raw).ok()?;
    let list: Vec<TrustedDesktopIdentity> = entries
        .into_iter()
        .filter(|entry| {
            matches!(entry.app.as_str(), "claude" | "codex" | "gemini")
                && entry.app_name.ends_with(".app")
                && !entry.app_name.contains('/')
                && !entry.app_name.contains("..")
        })
        .map(|entry| TrustedDesktopIdentity {
            app: entry.app,
            app_name: entry.app_name,
            bundle_id: entry.bundle_id,
            display_name: entry.display_name,
            reads_cli_config: entry.reads_cli_config,
            extra_roots: entry.extra_roots,
        })
        .collect();
    (!list.is_empty()).then_some(list)
}

fn trusted_identities() -> Vec<TrustedDesktopIdentity> {
    #[cfg(debug_assertions)]
    if let Some(debug) = debug_identities() {
        return debug;
    }
    builtin_trusted_identities()
}

fn target_id(app: &str, app_name: &str) -> String {
    let slug: String = app_name
        .trim_end_matches(".app")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    format!("{app}:desktop:{slug}")
}

// ── 重启资格票据（后端签发，短期有效）───────────────────────────────────

fn tickets() -> &'static Mutex<HashMap<(String, String), Instant>> {
    static TICKETS: OnceLock<Mutex<HashMap<(String, String), Instant>>> = OnceLock::new();
    TICKETS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 模型应用成功后调用：为本次 operationId 下的真实成功目标签发重启资格。
pub(crate) fn issue_restart_ticket(operation_id: &str, app: &str) {
    if let Ok(mut store) = tickets().lock() {
        store.insert(
            (operation_id.to_string(), app.to_string()),
            Instant::now() + TICKET_TTL,
        );
    }
}

/// 目标应用再次应用失败/登出时调用：使该应用的全部既有资格失效。
pub(crate) fn revoke_restart_tickets(app: &str) {
    if let Ok(mut store) = tickets().lock() {
        store.retain(|(_, ticket_app), _| ticket_app != app);
    }
}

/// 登出/会话切换时清空全部资格。
pub(crate) fn clear_restart_tickets() {
    if let Ok(mut store) = tickets().lock() {
        store.clear();
    }
}

fn has_restart_ticket(operation_id: &str, app: &str) -> bool {
    let Ok(mut store) = tickets().lock() else {
        return false;
    };
    let now = Instant::now();
    store.retain(|_, expires| *expires > now);
    store.contains_key(&(operation_id.to_string(), app.to_string()))
}

// ── 并发闸门：同一目标同时只能有一个重启操作 ─────────────────────────────

#[derive(Default)]
struct RestartGate {
    active: HashSet<String>,
}

fn restart_gate() -> &'static Mutex<RestartGate> {
    static GATE: OnceLock<Mutex<RestartGate>> = OnceLock::new();
    GATE.get_or_init(|| Mutex::new(RestartGate::default()))
}

struct GatePermit {
    key: String,
}

fn enter_restart_gate(key: &str) -> Result<GatePermit, String> {
    let mut gate = restart_gate()
        .lock()
        .map_err(|_| "relay.restart_busy".to_string())?;
    if !gate.active.insert(key.to_string()) {
        return Err("relay.restart_busy".to_string());
    }
    Ok(GatePermit {
        key: key.to_string(),
    })
}

impl Drop for GatePermit {
    fn drop(&mut self) {
        if let Ok(mut gate) = restart_gate().lock() {
            gate.active.remove(&self.key);
        }
    }
}

// ── 平台操作抽象（可注入测试替身）───────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RestartOpError {
    /// 目标拒绝了正常退出请求。
    Refused,
    /// 操作系统操作失败（osascript/open/plutil 调用失败等）。
    Failed,
}

pub(crate) trait RestartOps: Send + Sync {
    /// 在受信任位置定位候选 .app 目录。
    fn find_app(&self, identity: &TrustedDesktopIdentity) -> Option<PathBuf>;
    /// 从已安装 bundle 的 Info.plist 读取真实 bundle id（不猜测）。
    fn bundle_identifier(&self, app_root: &Path) -> Option<String>;
    /// CFBundleExecutable；缺失时回退 app 文件名。
    fn executable_name(&self, app_root: &Path) -> Option<String>;
    /// 该确切实例的主进程 pid：bundle id + 可执行路径双重匹配。
    fn running_pid(&self, exe_path: &Path, bundle_id: &str) -> Option<u32>;
    /// 请求正常退出（等价 Cmd+Q）。Ok 含“请求已送达/进程已不在”。
    fn request_quit(&self, bundle_id: &str, pid: u32) -> Result<(), RestartOpError>;
    /// 指定 pid 是否仍在运行。
    fn pid_alive(&self, pid: u32) -> bool;
    /// 重新打开同一个已验证 bundle。
    fn launch(&self, app_root: &Path) -> Result<(), RestartOpError>;
}

// ── macOS 实现：NSRunningApplication（JXA）+ plutil + open ───────────────

#[cfg(target_os = "macos")]
struct MacOsOps;

#[cfg(target_os = "macos")]
#[derive(serde::Deserialize)]
struct RunningAppInfo {
    pid: u32,
    #[serde(default)]
    exe: String,
    #[serde(default)]
    terminated: bool,
}

#[cfg(target_os = "macos")]
fn jxa(script: &str) -> Result<String, RestartOpError> {
    let output = std::process::Command::new("osascript")
        .args(["-l", "JavaScript", "-e", script])
        .output()
        .map_err(|_| RestartOpError::Failed)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(RestartOpError::Failed)
    }
}

#[cfg(target_os = "macos")]
fn js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

#[cfg(target_os = "macos")]
fn running_apps(bundle_id: &str) -> Result<Vec<RunningAppInfo>, RestartOpError> {
    let script = format!(
        "ObjC.import('Cocoa');\
         (function(){{\
           var apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier({bid});\
           var out = [];\
           for (var i = 0; i < apps.count; i++) {{\
             var a = apps.objectAtIndex(i);\
             out.push({{ pid: a.processIdentifier,\
                        exe: a.executableURL ? a.executableURL.path.js : '',\
                        terminated: !!a.isTerminated }});\
           }}\
           return JSON.stringify(out);\
         }})()",
        bid = js_string(bundle_id)
    );
    let raw = jxa(&script)?;
    serde_json::from_str(&raw).map_err(|_| RestartOpError::Failed)
}

#[cfg(target_os = "macos")]
fn read_info_plist_string(app_root: &Path, key: &str) -> Option<String> {
    let info = app_root.join("Contents").join("Info.plist");
    let from_plutil = std::process::Command::new("plutil")
        .args(["-extract", key, "raw", "-o", "-"])
        .arg(&info)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());
    from_plutil.or_else(|| {
        std::process::Command::new("defaults")
            .arg("read")
            .arg(app_root.join("Contents").join("Info"))
            .arg(key)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
    })
}

#[cfg(target_os = "macos")]
impl RestartOps for MacOsOps {
    fn find_app(&self, identity: &TrustedDesktopIdentity) -> Option<PathBuf> {
        let mut roots = identity.extra_roots.clone();
        roots.push(PathBuf::from("/Applications"));
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("Applications"));
        }
        roots
            .into_iter()
            .map(|root| root.join(&identity.app_name))
            .find(|candidate| candidate.is_dir())
    }

    fn bundle_identifier(&self, app_root: &Path) -> Option<String> {
        read_info_plist_string(app_root, "CFBundleIdentifier")
    }

    fn executable_name(&self, app_root: &Path) -> Option<String> {
        read_info_plist_string(app_root, "CFBundleExecutable").or_else(|| {
            app_root
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
        })
    }

    fn running_pid(&self, exe_path: &Path, bundle_id: &str) -> Option<u32> {
        // /tmp → /private/tmp 等符号链接会让 spawn 时的路径与 NSRunningApplication
        // 上报的 executableURL 不一致，比较前统一 canonicalize。
        let expected = std::fs::canonicalize(exe_path).unwrap_or_else(|_| exe_path.to_path_buf());
        running_apps(bundle_id)
            .ok()?
            .into_iter()
            .find(|app| {
                !app.terminated
                    && std::fs::canonicalize(&app.exe).unwrap_or_else(|_| PathBuf::from(&app.exe))
                        == expected
            })
            .map(|app| app.pid)
    }

    fn request_quit(&self, bundle_id: &str, pid: u32) -> Result<(), RestartOpError> {
        let script = format!(
            "ObjC.import('Cocoa');\
             (function(){{\
               var apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier({bid});\
               for (var i = 0; i < apps.count; i++) {{\
                 var a = apps.objectAtIndex(i);\
                 if (a.processIdentifier === {pid}) {{\
                   // JXA 桥接：读取 .terminate 属性即调用 -[NSRunningApplication terminate]
                   return a.terminate ? 'ok' : 'refused';\
                 }}\
               }}\
               return 'gone';\
             }})()",
            bid = js_string(bundle_id),
            pid = pid
        );
        match jxa(&script)?.as_str() {
            // 'gone' = 进程在请求前已自行退出，视为已退出成功。
            "ok" | "gone" => Ok(()),
            _ => Err(RestartOpError::Refused),
        }
    }

    fn pid_alive(&self, pid: u32) -> bool {
        let script = format!(
            "ObjC.import('Cocoa');\
             (function(){{\
               var a = $.NSRunningApplication.runningApplicationWithProcessIdentifier({pid});\
               return (a && a.processIdentifier > 0 && !a.isTerminated) ? 'true' : 'false';\
             }})()",
            pid = pid
        );
        jxa(&script).map(|out| out == "true").unwrap_or(false)
    }

    fn launch(&self, app_root: &Path) -> Result<(), RestartOpError> {
        // 按路径打开（不用 `open -b`）：duplicate bundle id 并存时仍指向同一已验证 bundle。
        std::process::Command::new("open")
            .arg(app_root)
            .status()
            .map_err(|_| RestartOpError::Failed)
            .and_then(|status| {
                if status.success() {
                    Ok(())
                } else {
                    Err(RestartOpError::Failed)
                }
            })
    }
}

// ── 非 macOS：诚实返回不支持 ───────────────────────────────────────────

#[cfg(not(target_os = "macos"))]
struct UnsupportedOps;

#[cfg(not(target_os = "macos"))]
impl RestartOps for UnsupportedOps {
    fn find_app(&self, _identity: &TrustedDesktopIdentity) -> Option<PathBuf> {
        None
    }
    fn bundle_identifier(&self, _app_root: &Path) -> Option<String> {
        None
    }
    fn executable_name(&self, _app_root: &Path) -> Option<String> {
        None
    }
    fn running_pid(&self, _exe_path: &Path, _bundle_id: &str) -> Option<u32> {
        None
    }
    fn request_quit(&self, _bundle_id: &str, _pid: u32) -> Result<(), RestartOpError> {
        Err(RestartOpError::Refused)
    }
    fn pid_alive(&self, _pid: u32) -> bool {
        false
    }
    fn launch(&self, _app_root: &Path) -> Result<(), RestartOpError> {
        Err(RestartOpError::Failed)
    }
}

pub(crate) fn platform_ops() -> Box<dyn RestartOps> {
    #[cfg(target_os = "macos")]
    return Box::new(MacOsOps);
    #[cfg(not(target_os = "macos"))]
    return Box::new(UnsupportedOps);
}

// ── 能力检测 ────────────────────────────────────────────────────────────

enum DesktopProbe {
    Verified(DesktopCandidate),
    /// 目录存在但 Info.plist 的 bundle id 与 allowlist 不符/不可读。
    Unverified,
}

struct DesktopCandidate {
    identity: TrustedDesktopIdentity,
    target_id: String,
    app_root: PathBuf,
    exe_path: PathBuf,
    running_pid: Option<u32>,
    /// allowlist 与远程注册表的交集——远程只能降级（true→false），不能提升。
    reads_cli_config: bool,
}

fn probe_desktops(app: &str, registry: &ToolRegistry, ops: &dyn RestartOps) -> Vec<DesktopProbe> {
    trusted_identities()
        .into_iter()
        .filter(|identity| identity.app == app)
        .filter_map(|identity| {
            let app_root = ops.find_app(&identity)?;
            // 统一规范化：/tmp → /private/tmp 等链接会让查找路径与
            // NSRunningApplication 上报的 executableURL 不一致。
            let app_root = std::fs::canonicalize(&app_root).unwrap_or(app_root);
            if ops.bundle_identifier(&app_root).as_deref() != Some(identity.bundle_id.as_str()) {
                return Some(DesktopProbe::Unverified);
            }
            let executable = ops
                .executable_name(&app_root)
                .unwrap_or_else(|| identity.app_name.trim_end_matches(".app").to_string());
            let exe_path = app_root.join("Contents").join("MacOS").join(&executable);
            let running_pid = ops.running_pid(&exe_path, &identity.bundle_id);
            let registry_reads = registry
                .tools
                .get(app)
                .and_then(|tool| {
                    tool.desktop_apps
                        .iter()
                        .find(|desktop| desktop.app_name == identity.app_name)
                })
                .map(|desktop| desktop.reads_cli_config);
            let reads_cli_config = match registry_reads {
                Some(from_registry) => identity.reads_cli_config && from_registry,
                None => identity.reads_cli_config,
            };
            Some(DesktopProbe::Verified(DesktopCandidate {
                target_id: target_id(app, &identity.app_name),
                identity,
                app_root,
                exe_path,
                running_pid,
                reads_cli_config,
            }))
        })
        .collect()
}

fn registry_desktop_display_name(
    registry: &ToolRegistry,
    app: &str,
    app_name: &str,
) -> Option<String> {
    registry
        .tools
        .get(app)?
        .desktop_apps
        .iter()
        .find(|desktop| desktop.app_name == app_name)
        .map(|desktop| desktop.display_name.clone())
}

fn cli_capability(app: &str, registry: &ToolRegistry) -> RelayRestartCapability {
    let installed = crate::commands::locate_tool_executable(app).is_some();
    RelayRestartCapability {
        app: app.to_string(),
        supported: false,
        installed,
        running: None,
        target_kind: "cli",
        target_id: None,
        display_name: registry
            .tools
            .get(app)
            .map(|tool| tool.display_name.clone()),
        // CLI 目标本身消费我们写入的配置；不支持自动重启是因为无法安全
        // 判断会话归属，强制退出会丢失正在进行的任务。
        reads_cli_config: true,
        reason: Some(if installed {
            "cli_session_unsafe".to_string()
        } else {
            "not_installed".to_string()
        }),
    }
}

fn desktop_shell_capability(
    app: &str,
    registry: &ToolRegistry,
    installed: bool,
    running: Option<bool>,
    reason: &str,
) -> RelayRestartCapability {
    RelayRestartCapability {
        app: app.to_string(),
        supported: false,
        installed,
        running,
        target_kind: "desktop",
        target_id: None,
        display_name: registry
            .tools
            .get(app)
            .map(|tool| tool.display_name.clone()),
        reads_cli_config: false,
        reason: Some(reason.to_string()),
    }
}

fn desktop_capability(
    app: &str,
    registry: &ToolRegistry,
    probes: Vec<DesktopProbe>,
) -> RelayRestartCapability {
    let verified: Vec<&DesktopCandidate> = probes
        .iter()
        .filter_map(|probe| match probe {
            DesktopProbe::Verified(candidate) => Some(candidate),
            DesktopProbe::Unverified => None,
        })
        .collect();
    if verified.is_empty() {
        return desktop_shell_capability(app, registry, true, None, "identity_unverified");
    }
    // 多个候选并存时优先重启正在运行的那个确切实例；否则取第一个已验证候选。
    let chosen = verified
        .iter()
        .find(|candidate| candidate.running_pid.is_some())
        .copied()
        .or_else(|| verified.first().copied())
        .expect("verified non-empty");
    let running = chosen.running_pid.is_some();
    let display = registry_desktop_display_name(registry, app, &chosen.identity.app_name)
        .or_else(|| Some(chosen.identity.display_name.clone()));
    if !chosen.reads_cli_config {
        return RelayRestartCapability {
            app: app.to_string(),
            supported: false,
            installed: true,
            running: Some(running),
            target_kind: "desktop",
            target_id: Some(chosen.target_id.clone()),
            display_name: display,
            reads_cli_config: false,
            reason: Some("config_not_shared".to_string()),
        };
    }
    RelayRestartCapability {
        app: app.to_string(),
        supported: true,
        installed: true,
        running: Some(running),
        target_kind: "desktop",
        target_id: Some(chosen.target_id.clone()),
        display_name: display,
        reads_cli_config: true,
        reason: None,
    }
}

fn capability_for(
    app: &str,
    registry: &ToolRegistry,
    ops: &dyn RestartOps,
) -> RelayRestartCapability {
    if cfg!(target_os = "macos") {
        let probes = probe_desktops(app, registry, ops);
        if !probes.is_empty() {
            return desktop_capability(app, registry, probes);
        }
        // 桌面入口未安装：codex 的重启目标就是桌面端 → not_installed；
        // claude/gemini 的主入口是 CLI → 回退手动指引。
        if app == "codex" {
            return desktop_shell_capability(app, registry, false, None, "not_installed");
        }
        return cli_capability(app, registry);
    }
    if app == "codex" {
        return desktop_shell_capability(app, registry, false, None, "platform_unsupported");
    }
    cli_capability(app, registry)
}

pub(crate) fn capabilities_with(
    registry: &ToolRegistry,
    ops: &dyn RestartOps,
) -> Vec<RelayRestartCapability> {
    ["claude", "codex", "gemini"]
        .iter()
        .map(|app| capability_for(app, registry, ops))
        .collect()
}

// ── 重启状态机 ──────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub(crate) struct RestartTiming {
    /// 等待正常退出的上限；超时返回 exit_timeout，不强杀。
    pub exit_timeout: Duration,
    /// 重新启动后等待进程出现的上限。
    pub launch_timeout: Duration,
    pub poll_interval: Duration,
}

impl Default for RestartTiming {
    fn default() -> Self {
        Self {
            exit_timeout: Duration::from_secs(10),
            launch_timeout: Duration::from_secs(10),
            poll_interval: Duration::from_millis(250),
        }
    }
}

fn restart_outcome(
    app: &str,
    target_id: &str,
    status: &'static str,
    reason: Option<&str>,
    exited: bool,
    started: bool,
) -> Result<RelayRestartResult, String> {
    Ok(RelayRestartResult {
        app: app.to_string(),
        target_id: target_id.to_string(),
        status,
        reason: reason.map(str::to_string),
        exited_existing_process: exited,
        started_new_process: started,
    })
}

/// 命令入口：校验目标、票据、并发闸门，然后执行状态机。
pub(crate) fn run_restart(
    registry: &ToolRegistry,
    ops: &dyn RestartOps,
    timing: RestartTiming,
    app: &str,
    target_id: &str,
    operation_id: &str,
    emit: &(dyn Fn(&str) + Send + Sync),
) -> Result<RelayRestartResult, String> {
    if !matches!(app, "claude" | "codex" | "gemini") {
        return Err("relay.invalid_target".to_string());
    }
    emit("checking");
    // 重启资格只能来自最近一次真实成功应用签发的票据。
    if !has_restart_ticket(operation_id, app) {
        return Err("relay.restart_expired".to_string());
    }
    let _permit = enter_restart_gate(&format!("{app}:{target_id}"))?;
    restart_exec(registry, ops, timing, app, target_id, emit)
}

fn restart_exec(
    registry: &ToolRegistry,
    ops: &dyn RestartOps,
    timing: RestartTiming,
    app: &str,
    target_id: &str,
    emit: &(dyn Fn(&str) + Send + Sync),
) -> Result<RelayRestartResult, String> {
    // 通用判定：有已验证桌面入口（allowlist + Info.plist bundle id 一致）
    // 的 app 走桌面重启流程；没有可信桌面入口的按各 app 语义诚实回退。
    let probes = probe_desktops(app, registry, ops);
    let verified: Vec<&DesktopCandidate> = probes
        .iter()
        .filter_map(|probe| match probe {
            DesktopProbe::Verified(candidate) => Some(candidate),
            DesktopProbe::Unverified => None,
        })
        .collect();
    if verified.is_empty() {
        emit("failed");
        let (status, reason) = if !probes.is_empty() {
            // 找到 .app 目录但身份不符/不可读
            ("unsupported", Some("identity_unverified"))
        } else if app == "codex" {
            if cfg!(target_os = "macos") {
                ("not_installed", None)
            } else {
                ("unsupported", Some("platform_unsupported"))
            }
        } else {
            // claude/gemini 没有可信桌面入口时仍是 CLI 目标
            ("unsupported", Some("cli_session_unsafe"))
        };
        return restart_outcome(app, target_id, status, reason, false, false);
    }
    // 目标由后端按与 capability 相同的规则重新选定（运行中优先），
    // renderer 回传的 target_id 必须与该选定一致——不能改指其他已验证实例。
    let chosen = verified
        .iter()
        .find(|candidate| candidate.running_pid.is_some())
        .copied()
        .or_else(|| verified.first().copied())
        .expect("verified non-empty");
    if chosen.target_id != target_id {
        return Err("relay.invalid_target".to_string());
    }
    if !chosen.reads_cli_config {
        emit("failed");
        return restart_outcome(
            app,
            target_id,
            "unsupported",
            Some("config_not_shared"),
            false,
            false,
        );
    }

    match chosen.running_pid {
        None => {
            // 原来未运行：诚实区分，不能声称“重启完成”。
            emit("starting");
            match ops.launch(&chosen.app_root) {
                Err(_) => {
                    emit("failed");
                    restart_outcome(app, target_id, "launch_failed", None, false, false)
                }
                Ok(()) if wait_for_running(ops, timing, chosen) => {
                    emit("done");
                    restart_outcome(app, target_id, "not_running_started", None, false, true)
                }
                Ok(()) => {
                    emit("failed");
                    restart_outcome(app, target_id, "launch_failed", None, false, false)
                }
            }
        }
        Some(pid) => {
            emit("requesting_exit");
            if ops.request_quit(&chosen.identity.bundle_id, pid).is_err() {
                emit("failed");
                return restart_outcome(app, target_id, "exit_refused", None, false, false);
            }
            emit("waiting_for_exit");
            let deadline = Instant::now() + timing.exit_timeout;
            while Instant::now() < deadline {
                if !ops.pid_alive(pid) {
                    break;
                }
                std::thread::sleep(timing.poll_interval);
            }
            if ops.pid_alive(pid) {
                // 超时即放弃：绝不强杀，也不提前启动第二实例。
                emit("failed");
                return restart_outcome(app, target_id, "exit_timeout", None, false, false);
            }
            emit("starting");
            match ops.launch(&chosen.app_root) {
                Err(_) => {
                    emit("failed");
                    restart_outcome(app, target_id, "launch_failed", None, true, false)
                }
                Ok(()) if wait_for_running(ops, timing, chosen) => {
                    emit("done");
                    restart_outcome(app, target_id, "restarted", None, true, true)
                }
                Ok(()) => {
                    emit("failed");
                    restart_outcome(app, target_id, "launch_failed", None, true, false)
                }
            }
        }
    }
}

fn wait_for_running(
    ops: &dyn RestartOps,
    timing: RestartTiming,
    chosen: &DesktopCandidate,
) -> bool {
    let deadline = Instant::now() + timing.launch_timeout;
    while Instant::now() < deadline {
        if ops
            .running_pid(&chosen.exe_path, &chosen.identity.bundle_id)
            .is_some()
        {
            return true;
        }
        std::thread::sleep(timing.poll_interval);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relay::tool_registry::{builtin_registry, DesktopToolDefinition, ToolRegistry};
    use serial_test::serial;

    // ── Fake driver ────────────────────────────────────────────────────

    #[derive(Clone)]
    struct FakeInstall {
        root: PathBuf,
        bundle_id: Option<String>,
        executable: Option<String>,
    }

    enum QuitOutcome {
        /// 正常退出：进程消失。
        Exits,
        /// 接受请求但进程不退（如被未保存更改挡住）→ 超时。
        Stays,
        /// 直接拒绝退出请求。
        Refuse,
        /// 请求送达失败。
        Fail,
    }

    enum LaunchOutcome {
        /// open 成功且进程出现。
        Appears,
        /// open 成功但进程始终不出现。
        Silent,
        /// open 失败。
        Fail,
    }

    #[derive(Default)]
    struct FakeOps {
        /// app_name → 安装；测试任意构造路径，驱动本身不校验位置。
        installs: HashMap<String, FakeInstall>,
        /// pid → exe_path：当前“活着”的进程。
        running: Mutex<HashMap<u32, PathBuf>>,
        next_pid: Mutex<u32>,
        quit: Mutex<Vec<QuitOutcome>>,
        launch: Mutex<Vec<LaunchOutcome>>,
        /// 调用轨迹，用于断言顺序与“没有强杀/没有提前启动”。
        calls: Mutex<Vec<String>>,
    }

    impl FakeOps {
        fn install(&mut self, app_name: &str, bundle_id: Option<&str>) -> PathBuf {
            let root = PathBuf::from(format!("/fake/Applications/{app_name}"));
            self.installs.insert(
                app_name.to_string(),
                FakeInstall {
                    root: root.clone(),
                    bundle_id: bundle_id.map(str::to_string),
                    executable: Some(app_name.trim_end_matches(".app").to_string()),
                },
            );
            root
        }

        fn spawn(&self, exe_path: &Path) -> u32 {
            let mut next = self.next_pid.lock().unwrap();
            let pid = {
                *next += 1;
                9000 + *next
            };
            self.running
                .lock()
                .unwrap()
                .insert(pid, exe_path.to_path_buf());
            pid
        }

        fn spawn_at(&self, install_root: &Path, executable: &str) -> u32 {
            self.spawn(&install_root.join("Contents").join("MacOS").join(executable))
        }

        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl RestartOps for FakeOps {
        fn find_app(&self, identity: &TrustedDesktopIdentity) -> Option<PathBuf> {
            self.installs
                .get(&identity.app_name)
                .map(|i| i.root.clone())
        }
        fn bundle_identifier(&self, app_root: &Path) -> Option<String> {
            self.installs
                .values()
                .find(|i| i.root == app_root)
                .and_then(|i| i.bundle_id.clone())
        }
        fn executable_name(&self, app_root: &Path) -> Option<String> {
            self.installs
                .values()
                .find(|i| i.root == app_root)
                .and_then(|i| i.executable.clone())
        }
        fn running_pid(&self, exe_path: &Path, _bundle_id: &str) -> Option<u32> {
            self.running
                .lock()
                .unwrap()
                .iter()
                .find(|(_, exe)| *exe == exe_path)
                .map(|(pid, _)| *pid)
        }
        fn request_quit(&self, bundle_id: &str, pid: u32) -> Result<(), RestartOpError> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("quit:{bundle_id}:{pid}"));
            match self
                .quit
                .lock()
                .unwrap()
                .pop()
                .unwrap_or(QuitOutcome::Exits)
            {
                QuitOutcome::Exits => {
                    self.running.lock().unwrap().remove(&pid);
                    Ok(())
                }
                QuitOutcome::Stays => Ok(()),
                QuitOutcome::Refuse => Err(RestartOpError::Refused),
                QuitOutcome::Fail => Err(RestartOpError::Failed),
            }
        }
        fn pid_alive(&self, pid: u32) -> bool {
            self.calls.lock().unwrap().push(format!("alive:{pid}"));
            self.running.lock().unwrap().contains_key(&pid)
        }
        fn launch(&self, app_root: &Path) -> Result<(), RestartOpError> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("launch:{}", app_root.display()));
            match self
                .launch
                .lock()
                .unwrap()
                .pop()
                .unwrap_or(LaunchOutcome::Appears)
            {
                LaunchOutcome::Appears => {
                    let install = self
                        .installs
                        .values()
                        .find(|i| i.root == app_root)
                        .expect("fake launch target installed");
                    self.spawn_at(app_root, install.executable.as_deref().unwrap_or("Fake"));
                    Ok(())
                }
                LaunchOutcome::Silent => Ok(()),
                LaunchOutcome::Fail => Err(RestartOpError::Failed),
            }
        }
    }

    fn fast_timing() -> RestartTiming {
        RestartTiming {
            exit_timeout: Duration::from_millis(60),
            launch_timeout: Duration::from_millis(60),
            poll_interval: Duration::from_millis(5),
        }
    }

    // ── helpers ────────────────────────────────────────────────────────

    fn codex_capability_of(ops: &dyn RestartOps) -> RelayRestartCapability {
        capabilities_with(&builtin_registry(), ops)
            .into_iter()
            .find(|c| c.app == "codex")
            .unwrap()
    }

    fn codex_capability_with(
        registry: &ToolRegistry,
        ops: &dyn RestartOps,
    ) -> RelayRestartCapability {
        capabilities_with(registry, ops)
            .into_iter()
            .find(|c| c.app == "codex")
            .unwrap()
    }

    // ── 测试 ────────────────────────────────────────────────────────────

    #[test]
    fn capability_reports_not_installed_when_no_candidate_exists() {
        let ops = FakeOps::default();
        let cap = codex_capability_of(&ops);
        assert!(!cap.supported);
        assert!(!cap.installed);
        assert_eq!(cap.running, None);
        assert_eq!(cap.reason.as_deref(), Some("not_installed"));
        assert_eq!(cap.target_id, None);
    }

    #[test]
    fn capability_detects_chatgpt_and_legacy_codex_names() {
        // ChatGPT.app：当前官方 Codex 桌面入口，已验证可重启。
        let mut ops = FakeOps::default();
        ops.install("ChatGPT.app", Some("com.openai.codex"));
        let cap = codex_capability_of(&ops);
        assert!(cap.supported && cap.installed);
        assert_eq!(cap.running, Some(false));
        assert_eq!(cap.target_id.as_deref(), Some("codex:desktop:chatgpt"));
        assert_eq!(cap.display_name.as_deref(), Some("ChatGPT (Codex)"));

        // 仅旧名 Codex.app：同样已验证身份，检测哪个就重启哪个。
        let mut ops = FakeOps::default();
        ops.install("Codex.app", Some("com.openai.codex"));
        let cap = codex_capability_of(&ops);
        assert!(cap.supported);
        assert_eq!(cap.target_id.as_deref(), Some("codex:desktop:codex"));
        assert_eq!(cap.display_name.as_deref(), Some("Codex (legacy name)"));
    }

    #[test]
    fn capability_prefers_the_running_instance_when_both_installed() {
        let mut ops = FakeOps::default();
        ops.install("ChatGPT.app", Some("com.openai.codex"));
        let codex_root = ops.install("Codex.app", Some("com.openai.codex"));
        ops.spawn_at(&codex_root, "Codex");
        let cap = codex_capability_of(&ops);
        // ChatGPT 未运行、Codex.app 在运行 → 选中运行中的确切实例。
        assert_eq!(cap.target_id.as_deref(), Some("codex:desktop:codex"));
        assert_eq!(cap.running, Some(true));
    }

    #[test]
    fn bundle_id_mismatch_is_identity_unverified_and_never_restartable() {
        let mut ops = FakeOps::default();
        ops.install("ChatGPT.app", Some("com.evil.impersonator"));
        let cap = codex_capability_of(&ops);
        assert!(!cap.supported);
        assert!(cap.installed);
        assert_eq!(cap.reason.as_deref(), Some("identity_unverified"));
        assert_eq!(cap.target_id, None);

        // Info.plist 完全不可读同样不可信。
        let mut ops = FakeOps::default();
        ops.install("ChatGPT.app", None);
        let cap = codex_capability_of(&ops);
        assert_eq!(cap.reason.as_deref(), Some("identity_unverified"));
    }

    #[test]
    fn claude_desktop_is_restartable_when_verified_installed() {
        // Claude.app 实测 bundle id = com.anthropic.claudefordesktop，
        // 其内嵌 Claude Code 会话消费 ~/.claude/settings.json → 真重启。
        let mut ops = FakeOps::default();
        ops.install("Claude.app", Some("com.anthropic.claudefordesktop"));
        let caps = capabilities_with(&builtin_registry(), &ops);
        let claude = caps.iter().find(|c| c.app == "claude").unwrap();
        assert!(claude.supported && claude.installed);
        assert_eq!(claude.target_kind, "desktop");
        assert_eq!(claude.target_id.as_deref(), Some("claude:desktop:claude"));
        assert_eq!(claude.running, Some(false));
    }

    #[test]
    fn claude_falls_back_to_cli_guidance_without_desktop() {
        // Claude.app 未安装 → 仍是 CLI 目标，保留手动指引。
        let ops = FakeOps::default();
        let caps = capabilities_with(&builtin_registry(), &ops);
        let claude = caps.iter().find(|c| c.app == "claude").unwrap();
        assert!(!claude.supported);
        assert_eq!(claude.target_kind, "cli");
        assert_eq!(claude.target_id, None);
        assert_eq!(claude.running, None);
    }

    #[test]
    fn claude_desktop_identity_mismatch_is_not_restartable() {
        let mut ops = FakeOps::default();
        ops.install("Claude.app", Some("com.evil.fake-claude"));
        let caps = capabilities_with(&builtin_registry(), &ops);
        let claude = caps.iter().find(|c| c.app == "claude").unwrap();
        assert!(!claude.supported);
        assert_eq!(claude.reason.as_deref(), Some("identity_unverified"));
        assert_eq!(claude.target_id, None);
    }

    #[test]
    fn gemini_never_becomes_desktop_restart_target() {
        // Gemini.app 不在 allowlist——即使安装也不可被检测/重启。
        let mut ops = FakeOps::default();
        ops.install("Gemini.app", Some("com.google.gemini"));
        let caps = capabilities_with(&builtin_registry(), &ops);
        let gemini = caps.iter().find(|c| c.app == "gemini").unwrap();
        assert!(!gemini.supported);
        assert_eq!(gemini.target_kind, "cli");
        assert_eq!(gemini.target_id, None);
    }

    #[test]
    fn remote_registry_cannot_authorize_new_terminable_identities() {
        // 远程注册表塞入任意 .app 名称：不在本地 allowlist，绝不能被检测/重启。
        let mut registry = builtin_registry();
        registry
            .tools
            .get_mut("codex")
            .unwrap()
            .desktop_apps
            .push(DesktopToolDefinition {
                app_name: "Evil.app".to_string(),
                display_name: "Evil".to_string(),
                reads_cli_config: true,
            });
        let mut ops = FakeOps::default();
        ops.install("Evil.app", Some("com.evil.backdoor"));
        let caps = capabilities_with(&registry, &ops);
        let codex = caps.iter().find(|c| c.app == "codex").unwrap();
        assert!(!codex.supported);
        assert_eq!(codex.reason.as_deref(), Some("not_installed"));
        // target_id 只能指向 allowlist 候选
        assert_ne!(codex.target_id.as_deref(), Some("codex:desktop:evil"));
    }

    #[test]
    fn remote_registry_can_only_downgrade_reads_cli_config() {
        let mut registry = builtin_registry();
        registry
            .tools
            .get_mut("codex")
            .unwrap()
            .desktop_apps
            .iter_mut()
            .for_each(|d| d.reads_cli_config = false);
        let mut ops = FakeOps::default();
        ops.install("ChatGPT.app", Some("com.openai.codex"));
        let cap = codex_capability_with(&registry, &ops);
        assert!(!cap.supported);
        assert_eq!(cap.reason.as_deref(), Some("config_not_shared"));
        // 远程不能反向把 allowlist 的 false 提升为 true（内置均为 true，验证降级方向）。
        assert!(!cap.reads_cli_config);
    }

    fn restart_with(
        ops: &FakeOps,
        app: &str,
        target_id: &str,
        operation_id: &str,
    ) -> (Result<RelayRestartResult, String>, Vec<String>) {
        let stages = Mutex::new(Vec::<String>::new());
        let emit = |stage: &str| stages.lock().unwrap().push(stage.to_string());
        let result = run_restart(
            &builtin_registry(),
            ops,
            fast_timing(),
            app,
            target_id,
            operation_id,
            &emit,
        );
        (result, stages.into_inner().unwrap())
    }

    #[test]
    #[serial]
    fn restart_requires_backend_issued_ticket() {
        clear_restart_tickets();
        let mut ops = FakeOps::default();
        ops.install("ChatGPT.app", Some("com.openai.codex"));
        let (result, _) = restart_with(&ops, "codex", "codex:desktop:chatgpt", "op-x");
        assert_eq!(result.unwrap_err(), "relay.restart_expired");
        assert!(ops.calls().is_empty(), "未取得票据前不得触碰进程");

        // 其他应用的票据不能借给 codex。
        issue_restart_ticket("op-x", "claude");
        let (result, _) = restart_with(&ops, "codex", "codex:desktop:chatgpt", "op-x");
        assert_eq!(result.unwrap_err(), "relay.restart_expired");

        // 过期票据无效。
        issue_restart_ticket("op-y", "codex");
        {
            let mut store = tickets().lock().unwrap();
            store.insert(
                ("op-y".to_string(), "codex".to_string()),
                Instant::now() - Duration::from_secs(1),
            );
        }
        let (result, _) = restart_with(&ops, "codex", "codex:desktop:chatgpt", "op-y");
        assert_eq!(result.unwrap_err(), "relay.restart_expired");
        clear_restart_tickets();
    }

    #[test]
    #[serial]
    fn restart_not_running_starts_exact_instance_without_claiming_restart() {
        clear_restart_tickets();
        let mut ops = FakeOps::default();
        let root = ops.install("ChatGPT.app", Some("com.openai.codex"));
        issue_restart_ticket("op-1", "codex");
        let (result, stages) = restart_with(&ops, "codex", "codex:desktop:chatgpt", "op-1");
        let result = result.unwrap();
        assert_eq!(result.status, "not_running_started");
        assert!(!result.exited_existing_process);
        assert!(result.started_new_process);
        assert_eq!(stages, vec!["checking", "starting", "done"]);
        // 没有 quit 调用——没有旧进程可退。
        assert!(!ops.calls().iter().any(|c| c.starts_with("quit:")));
        assert_eq!(
            ops.calls()
                .iter()
                .filter(|c| c.starts_with("launch:"))
                .count(),
            1
        );
        let _ = root;
        clear_restart_tickets();
    }

    #[test]
    #[serial]
    fn restart_running_quits_waits_then_relaunches_same_target() {
        clear_restart_tickets();
        let mut ops = FakeOps::default();
        let root = ops.install("ChatGPT.app", Some("com.openai.codex"));
        let pid = ops.spawn_at(&root, "ChatGPT");
        issue_restart_ticket("op-2", "codex");
        let (result, stages) = restart_with(&ops, "codex", "codex:desktop:chatgpt", "op-2");
        let result = result.unwrap();
        assert_eq!(result.status, "restarted");
        assert!(result.exited_existing_process && result.started_new_process);
        assert_eq!(
            stages,
            vec![
                "checking",
                "requesting_exit",
                "waiting_for_exit",
                "starting",
                "done"
            ]
        );
        let calls = ops.calls();
        let quit_at = calls
            .iter()
            .position(|c| *c == format!("quit:com.openai.codex:{pid}"))
            .expect("graceful quit requested");
        let launch_at = calls
            .iter()
            .position(|c| c.starts_with("launch:"))
            .expect("relaunch attempted");
        // 顺序保证：先请求退出 → 确认旧 pid 消失 → 再启动，绝不提前拉起第二实例。
        assert!(quit_at < launch_at);
        assert!(calls[quit_at..launch_at]
            .iter()
            .any(|c| c.starts_with("alive:")));
        // 全程没有强杀能力调用（driver 抽象上根本不存在 kill/terminate force 方法）。
        assert!(!calls
            .iter()
            .any(|c| c.contains("kill") || c.contains("force")));
        clear_restart_tickets();
    }

    #[test]
    #[serial]
    fn restart_exit_refused_and_exit_timeout_do_not_launch_second_instance() {
        clear_restart_tickets();
        // 拒绝退出
        let mut ops = FakeOps::default();
        let root = ops.install("ChatGPT.app", Some("com.openai.codex"));
        ops.spawn_at(&root, "ChatGPT");
        ops.quit.lock().unwrap().push(QuitOutcome::Refuse);
        issue_restart_ticket("op-3", "codex");
        let (result, stages) = restart_with(&ops, "codex", "codex:desktop:chatgpt", "op-3");
        let result = result.unwrap();
        assert_eq!(result.status, "exit_refused");
        assert!(!result.exited_existing_process && !result.started_new_process);
        assert_eq!(stages, vec!["checking", "requesting_exit", "failed"]);
        assert!(!ops.calls().iter().any(|c| c.starts_with("launch:")));

        // 退出请求送达失败（osascript 调用失败等）同样算 exit_refused
        let mut ops = FakeOps::default();
        let root = ops.install("ChatGPT.app", Some("com.openai.codex"));
        ops.spawn_at(&root, "ChatGPT");
        ops.quit.lock().unwrap().push(QuitOutcome::Fail);
        issue_restart_ticket("op-3b", "codex");
        let (result, _) = restart_with(&ops, "codex", "codex:desktop:chatgpt", "op-3b");
        assert_eq!(result.unwrap().status, "exit_refused");

        // 接受退出但进程不退 → 超时，绝不强杀、绝不启动第二实例
        let mut ops = FakeOps::default();
        let root = ops.install("ChatGPT.app", Some("com.openai.codex"));
        let pid = ops.spawn_at(&root, "ChatGPT");
        ops.quit.lock().unwrap().push(QuitOutcome::Stays);
        issue_restart_ticket("op-4", "codex");
        let (result, stages) = restart_with(&ops, "codex", "codex:desktop:chatgpt", "op-4");
        let result = result.unwrap();
        assert_eq!(result.status, "exit_timeout");
        assert!(!result.exited_existing_process && !result.started_new_process);
        assert!(stages.ends_with(&["failed".to_string()]));
        assert!(!ops.calls().iter().any(|c| c.starts_with("launch:")));
        // 确认等待了真实 pid
        assert!(ops.calls().iter().any(|c| *c == format!("alive:{pid}")));
        clear_restart_tickets();
    }

    #[test]
    #[serial]
    fn restart_launch_failure_is_honest_and_does_not_fake_success() {
        clear_restart_tickets();
        let mut ops = FakeOps::default();
        let root = ops.install("ChatGPT.app", Some("com.openai.codex"));
        ops.spawn_at(&root, "ChatGPT");
        ops.launch.lock().unwrap().push(LaunchOutcome::Fail);
        issue_restart_ticket("op-5", "codex");
        let (result, stages) = restart_with(&ops, "codex", "codex:desktop:chatgpt", "op-5");
        let result = result.unwrap();
        assert_eq!(result.status, "launch_failed");
        assert!(result.exited_existing_process && !result.started_new_process);
        assert_eq!(stages.last().map(String::as_str), Some("failed"));

        // open 成功但进程不出现同样算 launch_failed，不冒充重启成功。
        let mut ops = FakeOps::default();
        ops.install("ChatGPT.app", Some("com.openai.codex"));
        ops.launch.lock().unwrap().push(LaunchOutcome::Silent);
        issue_restart_ticket("op-6", "codex");
        let (result, _) = restart_with(&ops, "codex", "codex:desktop:chatgpt", "op-6");
        assert_eq!(result.unwrap().status, "launch_failed");
        clear_restart_tickets();
    }

    #[test]
    #[serial]
    fn restart_rejects_unknown_target_and_foreign_target_id() {
        clear_restart_tickets();
        let mut ops = FakeOps::default();
        ops.install("ChatGPT.app", Some("com.openai.codex"));
        issue_restart_ticket("op-7", "codex");
        // 未知应用名
        let (result, _) = {
            let stages = Mutex::new(Vec::new());
            let emit = |s: &str| stages.lock().unwrap().push(s.to_string());
            let r = run_restart(
                &builtin_registry(),
                &ops,
                fast_timing(),
                "evil",
                "evil:desktop:evil",
                "op-7",
                &emit,
            );
            (r, stages.into_inner().unwrap())
        };
        assert_eq!(result.unwrap_err(), "relay.invalid_target");
        // 回传 allowlist 内另一候选的 target_id（未安装该候选）→ 与后端选定不一致
        let (result, _) = restart_with(&ops, "codex", "codex:desktop:codex", "op-7");
        assert_eq!(result.unwrap_err(), "relay.invalid_target");

        // 全部候选均未安装 → 诚实返回 not_installed
        let ops = FakeOps::default();
        let (result, _) = restart_with(&ops, "codex", "codex:desktop:chatgpt", "op-7");
        let result = result.unwrap();
        assert_eq!(result.status, "not_installed");
        assert!(!result.exited_existing_process && !result.started_new_process);
        clear_restart_tickets();
    }

    #[test]
    #[serial]
    fn concurrent_restart_on_same_target_is_rejected() {
        clear_restart_tickets();
        let mut ops = FakeOps::default();
        let root = ops.install("ChatGPT.app", Some("com.openai.codex"));
        ops.spawn_at(&root, "ChatGPT");
        issue_restart_ticket("op-8", "codex");
        let _permit = enter_restart_gate("codex:codex:desktop:chatgpt").unwrap();
        let (result, _) = restart_with(&ops, "codex", "codex:desktop:chatgpt", "op-8");
        assert_eq!(result.unwrap_err(), "relay.restart_busy");
        drop(_permit);
        let (result, _) = restart_with(&ops, "codex", "codex:desktop:chatgpt", "op-8");
        assert!(result.is_ok());
        clear_restart_tickets();
    }

    #[test]
    #[serial]
    fn renderer_cannot_redirect_to_another_installed_instance() {
        clear_restart_tickets();
        let mut ops = FakeOps::default();
        ops.install("ChatGPT.app", Some("com.openai.codex"));
        ops.install("Codex.app", Some("com.openai.codex"));
        issue_restart_ticket("op-9", "codex");
        // capability 选中了 ChatGPT；renderer 回传 Codex.app 的 target_id →
        // 两者都验证通过但 chosen 由后端决定，回传不一致即拒绝。
        let (result, _) = restart_with(&ops, "codex", "codex:desktop:codex", "op-9");
        assert_eq!(result.unwrap_err(), "relay.invalid_target");
        clear_restart_tickets();
    }

    #[test]
    #[serial]
    fn claude_desktop_restart_uses_its_own_verified_identity() {
        clear_restart_tickets();
        let mut ops = FakeOps::default();
        let root = ops.install("Claude.app", Some("com.anthropic.claudefordesktop"));
        let pid = ops.spawn_at(&root, "Claude");
        issue_restart_ticket("op-claude", "claude");
        let (result, stages) = restart_with(&ops, "claude", "claude:desktop:claude", "op-claude");
        let result = result.unwrap();
        assert_eq!(result.status, "restarted");
        assert!(result.exited_existing_process && result.started_new_process);
        assert_eq!(
            stages,
            vec![
                "checking",
                "requesting_exit",
                "waiting_for_exit",
                "starting",
                "done"
            ]
        );
        // 退出请求用的是 Claude.app 自己的已验证 bundle id
        assert!(ops
            .calls()
            .iter()
            .any(|c| *c == format!("quit:com.anthropic.claudefordesktop:{pid}")));
        clear_restart_tickets();
    }

    #[test]
    #[serial]
    fn unsupported_apps_return_honest_status_not_error_or_fake_success() {
        clear_restart_tickets();
        let ops = FakeOps::default();
        issue_restart_ticket("op-10", "claude");
        let stages = Mutex::new(Vec::new());
        let emit = |s: &str| stages.lock().unwrap().push(s.to_string());
        let result = run_restart(
            &builtin_registry(),
            &ops,
            fast_timing(),
            "claude",
            "claude:cli:claude",
            "op-10",
            &emit,
        )
        .unwrap();
        assert_eq!(result.status, "unsupported");
        assert_eq!(result.reason.as_deref(), Some("cli_session_unsafe"));
        assert!(!result.exited_existing_process && !result.started_new_process);
        clear_restart_tickets();
    }

    // ── macOS 原生验收（真实进程操作，显式 opt-in）─────────────────────
    //
    // 运行方式（需要预先构建测试 App，见 RelayDesk 重启验收步骤）：
    //   RELAYDESK_RESTART_NATIVE=1 \
    //   RELAYDESK_RESTART_DEBUG_IDENTITIES='[{"app":"codex","appName":"RelayRestartTest.app","bundleId":"com.relaydesk.restart-test","displayName":"Restart Test App","readsCliConfig":true,"extraRoots":["/tmp/relaydesk-native-test"]}]' \
    //   RELAYDESK_RESTART_NATIVE_APP=/tmp/relaydesk-native-test/RelayRestartTest.app \
    //   cargo test --lib native_acceptance -- --ignored --nocapture
    //
    // 覆盖：未运行→启动、运行中→正常退出→重启、退出拒绝/超时（不强杀）、
    // 启动失败、未安装。测试 App 通过
    // `/tmp/relaydesk-restart-refuse` 标记文件在 applicationShouldTerminate
    // 中返回 NSTerminateCancel 模拟拒绝退出。

    #[cfg(target_os = "macos")]
    fn wait_pid_running(
        ops: &dyn RestartOps,
        exe_path: &Path,
        bundle_id: &str,
        timeout: Duration,
    ) -> Option<u32> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if let pid @ Some(_) = ops.running_pid(exe_path, bundle_id) {
                return pid;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        None
    }

    #[test]
    #[ignore = "native macOS acceptance: real process ops, opt-in via env"]
    #[serial]
    #[cfg(target_os = "macos")]
    fn native_acceptance_restart_lifecycle() {
        if std::env::var("RELAYDESK_RESTART_NATIVE").as_deref() != Ok("1") {
            eprintln!("skip: RELAYDESK_RESTART_NATIVE=1 not set");
            return;
        }
        let Ok(app_path) = std::env::var("RELAYDESK_RESTART_NATIVE_APP") else {
            eprintln!("skip: RELAYDESK_RESTART_NATIVE_APP not set");
            return;
        };
        let app_root = PathBuf::from(app_path);
        assert!(
            app_root.is_dir(),
            "test app missing at {}",
            app_root.display()
        );
        let refuse_marker = std::env::var("RELAYDESK_RESTART_NATIVE_REFUSE")
            .unwrap_or_else(|_| "/tmp/relaydesk-restart-refuse".to_string());
        let _ = std::fs::remove_file(&refuse_marker);
        clear_restart_tickets();

        let ops = platform_ops();
        let ops = ops.as_ref();
        let registry = builtin_registry();
        let emit = |stage: &str| eprintln!("[relay-restart-progress] {stage}");

        // 1) 能力检测：注入的测试身份被验证并选中
        let caps = capabilities_with(&registry, ops);
        let cap = caps.iter().find(|c| c.app == "codex").unwrap();
        assert!(cap.installed && cap.supported, "capability: {cap:?}");
        let target_id = cap.target_id.clone().unwrap();
        assert_eq!(cap.target_kind, "desktop");
        let exe_name = ops.executable_name(&app_root).unwrap();
        let exe_path = app_root.join("Contents").join("MacOS").join(&exe_name);
        let bundle_id = ops.bundle_identifier(&app_root).unwrap();
        eprintln!("[native] bundle_id={bundle_id} exe={exe_name}");

        // 预清理：若已在运行，先正常退出
        if let Some(pid) = ops.running_pid(&exe_path, &bundle_id) {
            let _ = ops.request_quit(&bundle_id, pid);
            let deadline = Instant::now() + Duration::from_secs(5);
            while ops.pid_alive(pid) && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(200));
            }
        }

        issue_restart_ticket("native-op", "codex");

        // 2) 未运行 → 启动（不得声称重启完成）
        let r = run_restart(
            &registry,
            ops,
            RestartTiming::default(),
            "codex",
            &target_id,
            "native-op",
            &emit,
        )
        .unwrap();
        assert_eq!(r.status, "not_running_started");
        assert!(!r.exited_existing_process && r.started_new_process);
        let pid1 = wait_pid_running(ops, &exe_path, &bundle_id, Duration::from_secs(10))
            .expect("test app did not start");
        eprintln!("[native] started pid={pid1}");

        // 3) 运行中 → 正常退出 → 等待 → 重新启动同一目标
        let r = run_restart(
            &registry,
            ops,
            RestartTiming::default(),
            "codex",
            &target_id,
            "native-op",
            &emit,
        )
        .unwrap();
        assert_eq!(r.status, "restarted");
        assert!(r.exited_existing_process && r.started_new_process);
        assert!(!ops.pid_alive(pid1), "old pid still alive after restart");
        let pid2 = wait_pid_running(ops, &exe_path, &bundle_id, Duration::from_secs(10))
            .expect("test app did not relaunch");
        assert_ne!(pid1, pid2, "restarted pid should differ");
        eprintln!("[native] restarted pid={pid2}");

        // 4) 拒绝退出 → exit_timeout，且进程仍在（未被强杀、未提前启动第二实例）
        std::fs::write(&refuse_marker, b"refuse").unwrap();
        let r = run_restart(
            &registry,
            ops,
            RestartTiming::default(),
            "codex",
            &target_id,
            "native-op",
            &emit,
        )
        .unwrap();
        assert_eq!(r.status, "exit_timeout");
        assert!(!r.started_new_process);
        assert!(ops.pid_alive(pid2), "refused app was force-killed");
        eprintln!("[native] exit_timeout ok, pid={pid2} still alive");
        std::fs::remove_file(&refuse_marker).unwrap();

        // 5) 启动失败：可执行文件缺失 → open 失败 → launch_failed（旧进程已退出）
        let exe_file = app_root.join("Contents").join("MacOS").join(&exe_name);
        let exe_bak = exe_file.with_extension("disabled");
        std::fs::rename(&exe_file, &exe_bak).unwrap();
        let r = run_restart(
            &registry,
            ops,
            RestartTiming::default(),
            "codex",
            &target_id,
            "native-op",
            &emit,
        )
        .unwrap();
        assert_eq!(r.status, "launch_failed");
        assert!(r.exited_existing_process && !r.started_new_process);
        std::fs::rename(&exe_bak, &exe_file).unwrap();
        eprintln!("[native] launch_failed ok");

        // 6) 未安装：移走 .app → not_installed
        let moved = app_root.with_extension("moved");
        std::fs::rename(&app_root, &moved).unwrap();
        let caps = capabilities_with(&registry, ops);
        let cap = caps.iter().find(|c| c.app == "codex").unwrap();
        assert!(!cap.installed);
        assert_eq!(cap.reason.as_deref(), Some("not_installed"));
        let r = run_restart(
            &registry,
            ops,
            RestartTiming::default(),
            "codex",
            &target_id,
            "native-op",
            &emit,
        )
        .unwrap();
        assert_eq!(r.status, "not_installed");
        std::fs::rename(&moved, &app_root).unwrap();
        eprintln!("[native] not_installed ok");

        clear_restart_tickets();
        let _ = std::fs::remove_file(&refuse_marker);
        eprintln!("[native] all scenarios passed; test app left not running");
    }

    /// 真实安装检测（不退出任何进程）：验证本机 ChatGPT.app/Codex.app 的
    /// allowlist 身份可被发现且 supported。仅在未注入 debug 身份时有效。
    #[test]
    #[ignore = "native macOS acceptance: real install detection, opt-in via env"]
    #[serial]
    #[cfg(target_os = "macos")]
    fn native_detection_real_install() {
        if std::env::var("RELAYDESK_RESTART_NATIVE").as_deref() != Ok("1")
            || std::env::var("RELAYDESK_RESTART_DEBUG_IDENTITIES").is_ok()
        {
            eprintln!("skip: run without RELAYDESK_RESTART_DEBUG_IDENTITIES, set RELAYDESK_RESTART_NATIVE=1");
            return;
        }
        let ops = platform_ops();
        let caps = capabilities_with(&builtin_registry(), ops.as_ref());
        let codex = caps.iter().find(|c| c.app == "codex").unwrap();
        eprintln!("[native-detect] codex capability: {codex:?}");
        assert!(codex.installed, "expected ChatGPT.app or Codex.app present");
        assert!(codex.supported);
        assert_eq!(codex.target_kind, "desktop");
        assert!(
            matches!(
                codex.target_id.as_deref(),
                Some("codex:desktop:chatgpt") | Some("codex:desktop:codex")
            ),
            "unexpected target_id: {:?}",
            codex.target_id
        );
        // Claude.app 若已安装：应为 supported desktop（实测身份
        // com.anthropic.claudefordesktop）；未安装则回退 CLI 指引。
        let claude = caps.iter().find(|c| c.app == "claude").unwrap();
        eprintln!("[native-detect] claude capability: {claude:?}");
        if Path::new("/Applications/Claude.app").is_dir() {
            assert!(claude.installed && claude.supported);
            assert_eq!(claude.target_id.as_deref(), Some("claude:desktop:claude"));
        } else {
            assert_eq!(claude.target_kind, "cli");
            assert!(!claude.supported);
        }
        // 只检测，不执行重启。
    }

    /// 真实应用重启验收公共逻辑：detect → （未运行则冷启动）→ quit → wait → relaunch。
    /// `keep_running`：验收前已在运行的应用保持重启后的运行态；否则退回原状态。
    #[cfg(target_os = "macos")]
    fn native_restart_real_app(
        ops: &dyn RestartOps,
        registry: &ToolRegistry,
        app: &str,
        target: &str,
        app_root: &Path,
        exe_name: &str,
        bundle_id: &str,
        label: &str,
    ) {
        let exe_path = app_root.join("Contents").join("MacOS").join(exe_name);
        let emit = |stage: &str| eprintln!("[{label}-progress] {stage}");
        let op = format!("native-{label}-op");
        issue_restart_ticket(&op, app);

        // 未运行 → 启动（不冒充重启完成）
        let was_running = ops.running_pid(&exe_path, bundle_id);
        if was_running.is_none() {
            let r = run_restart(
                registry,
                ops,
                RestartTiming::default(),
                app,
                target,
                &op,
                &emit,
            )
            .unwrap();
            assert_eq!(r.status, "not_running_started");
            eprintln!("[{label}] cold start ok");
        }
        let pid1 = wait_pid_running(ops, &exe_path, bundle_id, Duration::from_secs(20))
            .unwrap_or_else(|| panic!("{label}: app did not start"));

        // 运行中 → 正常退出 → 等待 → 重启同一实例
        let r = run_restart(
            registry,
            ops,
            RestartTiming::default(),
            app,
            target,
            &op,
            &emit,
        )
        .unwrap();
        assert_eq!(r.status, "restarted");
        assert!(r.exited_existing_process && r.started_new_process);
        let pid2 = wait_pid_running(ops, &exe_path, bundle_id, Duration::from_secs(20))
            .unwrap_or_else(|| panic!("{label}: app did not relaunch"));
        assert_ne!(pid1, pid2, "{label}: restart must produce a new pid");
        assert!(!ops.pid_alive(pid1), "{label}: old pid still alive");
        eprintln!("[{label}] restarted {pid1} -> {pid2}");

        // 恢复原状态：原本没运行的应用退回去；原本在跑的保持重启后的运行态。
        if was_running.is_none() {
            if ops.request_quit(bundle_id, pid2).is_ok() {
                let deadline = Instant::now() + Duration::from_secs(10);
                while ops.pid_alive(pid2) && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(250));
                }
            }
            eprintln!("[{label}] restored to not-running");
        } else {
            eprintln!("[{label}] left running (was running before)");
        }
    }

    /// 真实 Claude.app 重启验收：走生产代码路径（内置 allowlist，无 debug 注入）。
    ///   RELAYDESK_RESTART_NATIVE=1 RELAYDESK_RESTART_REAL_CLAUDE=1 \
    ///   cargo test --lib native_restart_real_claude -- --ignored --nocapture
    #[test]
    #[ignore = "native macOS acceptance: real Claude.app quit+relaunch, opt-in via env"]
    #[serial]
    #[cfg(target_os = "macos")]
    fn native_restart_real_claude() {
        if std::env::var("RELAYDESK_RESTART_NATIVE").as_deref() != Ok("1")
            || std::env::var("RELAYDESK_RESTART_REAL_CLAUDE").as_deref() != Ok("1")
            || std::env::var("RELAYDESK_RESTART_DEBUG_IDENTITIES").is_ok()
        {
            eprintln!("skip: need RELAYDESK_RESTART_NATIVE=1 RELAYDESK_RESTART_REAL_CLAUDE=1 without debug identities");
            return;
        }
        let app_root = PathBuf::from("/Applications/Claude.app");
        if !app_root.is_dir() {
            eprintln!("skip: /Applications/Claude.app not installed");
            return;
        }
        clear_restart_tickets();
        let ops = platform_ops();
        let registry = builtin_registry();

        let caps = capabilities_with(&registry, ops.as_ref());
        let claude = caps.iter().find(|c| c.app == "claude").unwrap();
        eprintln!("[claude] capability: {claude:?}");
        assert!(claude.installed && claude.supported);
        assert_eq!(claude.target_id.as_deref(), Some("claude:desktop:claude"));

        native_restart_real_app(
            ops.as_ref(),
            &registry,
            "claude",
            "claude:desktop:claude",
            &app_root,
            "Claude",
            "com.anthropic.claudefordesktop",
            "claude",
        );
        clear_restart_tickets();
    }

    /// 真实 ChatGPT.app（Codex 桌面入口）重启验收：走生产代码路径。
    /// 若 ChatGPT.app 正在运行会做一次真实 quit→relaunch（由调用者确认）。
    ///   RELAYDESK_RESTART_NATIVE=1 RELAYDESK_RESTART_REAL_CODEX=1 \
    ///   cargo test --lib native_restart_real_codex -- --ignored --nocapture
    #[test]
    #[ignore = "native macOS acceptance: real ChatGPT.app quit+relaunch, opt-in via env"]
    #[serial]
    #[cfg(target_os = "macos")]
    fn native_restart_real_codex() {
        if std::env::var("RELAYDESK_RESTART_NATIVE").as_deref() != Ok("1")
            || std::env::var("RELAYDESK_RESTART_REAL_CODEX").as_deref() != Ok("1")
            || std::env::var("RELAYDESK_RESTART_DEBUG_IDENTITIES").is_ok()
        {
            eprintln!("skip: need RELAYDESK_RESTART_NATIVE=1 RELAYDESK_RESTART_REAL_CODEX=1 without debug identities");
            return;
        }
        clear_restart_tickets();
        let ops = platform_ops();
        let registry = builtin_registry();

        // 用能力检测选中的确切实例（ChatGPT.app 或旧名 Codex.app）
        let caps = capabilities_with(&registry, ops.as_ref());
        let codex = caps.iter().find(|c| c.app == "codex").unwrap();
        eprintln!("[codex] capability: {codex:?}");
        assert!(codex.installed && codex.supported);
        let target = codex.target_id.clone().unwrap();
        let app_name = match target.as_str() {
            "codex:desktop:chatgpt" => "ChatGPT.app",
            "codex:desktop:codex" => "Codex.app",
            other => panic!("unexpected codex target {other}"),
        };
        let app_root = PathBuf::from("/Applications").join(app_name);
        let exe_name = ops.executable_name(&app_root).unwrap();

        native_restart_real_app(
            ops.as_ref(),
            &registry,
            "codex",
            &target,
            &app_root,
            &exe_name,
            "com.openai.codex",
            "codex",
        );
        clear_restart_tickets();
    }

    /// 全链路真实验收：真实会话 DB → 真实 apply_model → 按 relay_apply_model
    /// 命令相同的逻辑签发票据 → 真实 capability → 真实重启目标桌面端。
    /// 需要 dev/生产安装已登录 RelayDesk 账号；写真实 live 配置文件并真实
    /// 退出/启动目标 App。
    ///   RELAYDESK_LIVE_E2E=1 RELAYDESK_LIVE_E2E_TARGET=claude \
    ///   RELAYDESK_LIVE_E2E_GROUP=<分组> RELAYDESK_LIVE_E2E_MODEL=<模型> \
    ///   cargo test --lib live_apply_restart -- --ignored --nocapture
    #[test]
    #[ignore = "live E2E: real session + real apply + real app restart, opt-in"]
    #[cfg(target_os = "macos")]
    fn live_apply_restart() {
        if std::env::var("RELAYDESK_LIVE_E2E").as_deref() != Ok("1") {
            eprintln!("skip: set RELAYDESK_LIVE_E2E=1 to run against the real session");
            return;
        }
        let target_app =
            std::env::var("RELAYDESK_LIVE_E2E_TARGET").unwrap_or_else(|_| "claude".to_string());
        assert!(
            matches!(target_app.as_str(), "claude" | "codex"),
            "live E2E 只验收可自动重启的桌面目标"
        );

        let db = crate::Database::init().expect("Database::init failed");
        let state = crate::store::AppState::new(std::sync::Arc::new(db));
        assert!(
            state.db.get_relay_account().ok().flatten().is_some(),
            "live E2E 需要已登录的 RelayDesk 会话"
        );

        let operation = format!("live-e2e-{target_app}");
        let emit_apply = |stage: &str, app: Option<&str>| {
            eprintln!(
                "[live-apply] {stage}{}",
                app.map(|a| format!(" → {a}")).unwrap_or_default()
            );
        };
        let results = tauri::async_runtime::block_on(async {
            let grouped = crate::relay::RelayService::models(&state)
                .await
                .expect("models failed");
            let group = std::env::var("RELAYDESK_LIVE_E2E_GROUP")
                .ok()
                .or_else(|| {
                    grouped
                        .iter()
                        .find(|g| !g.models.is_empty())
                        .map(|g| g.group.clone())
                })
                .expect("no group with models");
            let model = std::env::var("RELAYDESK_LIVE_E2E_MODEL")
                .ok()
                .or_else(|| {
                    grouped
                        .iter()
                        .find(|g| g.group == group)
                        .and_then(|g| g.models.first())
                        .map(|m| m.id.clone())
                })
                .expect("no model in group");
            eprintln!("[live-apply] group={group} model={model} target={target_app}");
            crate::relay::RelayService::apply_model(
                &state,
                &group,
                &model,
                Some(&[target_app.clone()]),
                emit_apply,
            )
            .await
            .expect("apply_model failed")
        });

        // 与 relay_apply_model 命令相同的票据签发逻辑：成功签发、失败吊销。
        clear_restart_tickets();
        for result in &results {
            if result.ok {
                issue_restart_ticket(&operation, &result.app);
            } else {
                revoke_restart_tickets(&result.app);
            }
        }
        assert!(
            results.iter().any(|r| r.app == target_app && r.ok),
            "apply 未成功，结果: {results:?}"
        );
        eprintln!("[live-apply] ticket issued for {target_app}");

        let ops = platform_ops();
        let registry = builtin_registry();
        let caps = capabilities_with(&registry, ops.as_ref());
        let cap = caps.iter().find(|c| c.app == target_app).unwrap();
        eprintln!("[live-cap] {cap:?}");
        assert!(cap.supported && cap.installed, "目标不可自动重启: {cap:?}");
        let target_id = cap.target_id.clone().expect("supported 必须有 target_id");

        // 无票据调用必须拒绝（先验票据后执行）。
        let emit = |stage: &str| eprintln!("[live-restart] {stage}");
        let denied = run_restart(
            &registry,
            ops.as_ref(),
            RestartTiming::default(),
            &target_app,
            &target_id,
            "no-such-operation",
            &emit,
        );
        assert!(matches!(denied, Err(ref e) if e == "relay.restart_expired"));

        // 未运行 → 启动（not_running_started），运行中 → 完整重启。
        let (app_name, exe_name, bundle_id) = match target_id.as_str() {
            "claude:desktop:claude" => ("Claude.app", "Claude", "com.anthropic.claudefordesktop"),
            "codex:desktop:chatgpt" => ("ChatGPT.app", "ChatGPT", "com.openai.codex"),
            "codex:desktop:codex" => ("Codex.app", "Codex", "com.openai.codex"),
            other => panic!("unexpected target {other}"),
        };
        let app_root = PathBuf::from("/Applications").join(app_name);
        native_restart_real_app(
            ops.as_ref(),
            &registry,
            &target_app,
            &target_id,
            &app_root,
            exe_name,
            bundle_id,
            "live",
        );
        clear_restart_tickets();
        eprintln!("[live-e2e] PASS {target_app}");
    }
}
