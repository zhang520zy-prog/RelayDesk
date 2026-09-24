//! RelayDesk 受控端到端验证工具（非生产二进制，仅供测试环境使用）。
//!
//! 真实链路：登录 → 分组/模型 → 应用模型 → 检查三个 CLI live 文件。
//! 所有文件写入均落在 `RELAYDESK_TEST_HOME` 指定的临时根目录内；
//! 凭据从环境变量读取，不落盘、不硬编码。
//!
//! 用法：
//!   RELAYDESK_TEST_HOME=/tmp/relaydesk-e2e-xxx \
//!   RELAYDESK_E2E_USER=<user> RELAYDESK_E2E_PASS=<pass> \
//!   cargo run --bin relaydesk_e2e
//!
//! 可选环境变量：
//!   RELAYDESK_E2E_BASE   中转站地址（默认 https://www.shenlanqaq.com）
//!   RELAYDESK_E2E_GROUP  指定应用的分组（默认取第一个含模型的分组）
//!   RELAYDESK_E2E_MODEL  指定应用的模型（默认取该分组第一个模型）
//!   RELAYDESK_E2E_KEEP_TOKEN=1  保留创建的分组令牌（默认结束后吊销）

use std::path::{Path, PathBuf};
use std::sync::Arc;

use relaydesk_lib::relay::{RelayApplyApps, RelayService};
use relaydesk_lib::{AppState, Database};

const DEFAULT_BASE: &str = "https://www.shenlanqaq.com";

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("[e2e] FAIL: {e}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    // ── 安全防护：必须显式隔离 home，且不得等于真实 home ──────────
    let test_home = std::env::var("RELAYDESK_TEST_HOME")
        .map_err(|_| "RELAYDESK_TEST_HOME 未设置——拒绝在真实 home 下运行".to_string())?;
    let test_home = PathBuf::from(test_home);
    if test_home.as_os_str().is_empty() {
        return Err("RELAYDESK_TEST_HOME 为空".to_string());
    }
    if dirs::home_dir().as_deref() == Some(test_home.as_path()) {
        return Err("RELAYDESK_TEST_HOME 指向真实 home，拒绝运行".to_string());
    }
    std::fs::create_dir_all(&test_home).map_err(|e| format!("创建测试根目录失败: {e}"))?;
    println!("[e2e] 隔离测试根: {}", test_home.display());

    let base = std::env::var("RELAYDESK_E2E_BASE").unwrap_or_else(|_| DEFAULT_BASE.to_string());
    let user = std::env::var("RELAYDESK_E2E_USER").map_err(|_| "RELAYDESK_E2E_USER 未设置")?;
    let pass = std::env::var("RELAYDESK_E2E_PASS").map_err(|_| "RELAYDESK_E2E_PASS 未设置")?;
    let keep_token = std::env::var("RELAYDESK_E2E_KEEP_TOKEN").as_deref() == Ok("1");

    // ── 1. 真实 DB（落在测试根的 .relaydesk 下，走生产 init/migration 路径）
    let db = Database::init().map_err(|e| format!("Database::init: {e}"))?;
    let state = AppState::new(Arc::new(db));

    // ── 2. 登录 ─────────────────────────────────────────────────
    println!("[e2e] 步骤 1/6 登录 {base} …");
    let account = RelayService::login(&state, &base, &user, &pass, false)
        .await
        .map_err(|e| format!("登录失败: {e}"))?;
    println!(
        "[e2e]   登录成功: user={} quota={} used={} group={}",
        account.username, account.quota, account.used_quota, account.group
    );

    // ── 3. 开启全部三个下发目标 ─────────────────────────────────
    let account = RelayService::set_apply_apps(
        &state,
        RelayApplyApps {
            claude: true,
            codex: true,
            gemini: true,
        },
    )
    .map_err(|e| format!("set_apply_apps: {e}"))?;
    println!(
        "[e2e]   目标: claude={} codex={} gemini={}",
        account.apply_apps.claude, account.apply_apps.codex, account.apply_apps.gemini
    );

    // ── 4. 分组与模型 ───────────────────────────────────────────
    println!("[e2e] 步骤 2/6 拉取分组 …");
    let groups = RelayService::groups(&state)
        .await
        .map_err(|e| format!("groups: {e}"))?;
    println!("[e2e]   可用分组 {} 个:", groups.len());
    for g in &groups {
        println!(
            "[e2e]     - {} ratio={:?} {}",
            g.name,
            g.ratio,
            g.desc.as_deref().unwrap_or("")
        );
    }

    println!("[e2e] 步骤 3/6 拉取模型 …");
    let grouped = RelayService::models(&state)
        .await
        .map_err(|e| format!("models: {e}"))?;
    for gm in &grouped {
        println!("[e2e]   分组 {}: {} 个模型", gm.group, gm.models.len());
    }

    let group = std::env::var("RELAYDESK_E2E_GROUP")
        .ok()
        .or_else(|| {
            grouped
                .iter()
                .find(|g| !g.models.is_empty())
                .map(|g| g.group.clone())
        })
        .ok_or("没有可用分组")?;
    let model = std::env::var("RELAYDESK_E2E_MODEL").ok().or_else(|| {
        grouped
            .iter()
            .find(|g| g.group == group)
            .and_then(|g| g.models.first())
            .map(|m| m.id.clone())
    });
    let model = model.ok_or_else(|| format!("分组 {group} 下没有模型"))?;
    println!("[e2e] 选定: group={group} model={model}");

    // ── 5. 应用模型（真实写 live 文件 → 测试根下）────────────────
    // RELAYDESK_E2E_TARGETS=codex,claude 模拟前端按分组推断的目标子集；
    // 未设置时应用全部启用目标（旧行为）。
    println!("[e2e] 步骤 4/6 应用模型（写 live 配置）…");
    let target_apps: Option<Vec<String>> = std::env::var("RELAYDESK_E2E_TARGETS").ok().map(|v| {
        v.split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    });
    if let Some(t) = &target_apps {
        println!("[e2e]   目标子集: {t:?}");
    }
    let results = RelayService::apply_model(
        &state,
        &group,
        &model,
        target_apps.as_deref(),
        |phase, app| match app {
            Some(a) => println!("[e2e]   进度: {phase} → {a}"),
            None => println!("[e2e]   进度: {phase}"),
        },
    )
    .await
    .map_err(|e| format!("apply_model: {e}"))?;
    for r in &results {
        println!(
            "[e2e]   结果: {} ok={} provider={:?} err={:?}",
            r.app, r.ok, r.provider_id, r.error
        );
    }
    if !results.iter().all(|r| r.ok) {
        return Err("存在失败的应用目标".to_string());
    }

    // ── 6. 校验 live 文件：目标内必须写对，目标外必须未被创建 ─────
    println!("[e2e] 步骤 5/6 校验 live 文件 …");
    let mut failures = Vec::new();
    let wanted = |app: &str| {
        target_apps
            .as_ref()
            .map(|t| t.iter().any(|x| x == app))
            .unwrap_or(true)
    };
    let claude_file = test_home.join(".claude/settings.json");
    let codex_file = test_home.join(".codex/config.toml");
    let gemini_file = test_home.join(".gemini/.env");
    if wanted("claude") {
        check_live(&claude_file, "claude", &base, &model, &mut failures);
    } else if claude_file.exists() {
        failures.push("claude 非目标但 settings.json 被创建".to_string());
    } else {
        println!("[e2e]   claude: 非目标，未写入（符合预期）");
    }
    if wanted("codex") {
        check_live(&codex_file, "codex", &base, &model, &mut failures);
        // auth.json 仅 OAuth 型供应商需要；中转站 bearer token 内嵌 config.toml
        let auth = test_home.join(".codex/auth.json");
        if auth.exists() {
            check_live(&auth, "codex-auth", &base, &model, &mut failures);
        } else {
            println!("[e2e]   codex-auth: auth.json 未生成（bearer-token 供应商，符合预期）");
        }
    } else if codex_file.exists() {
        failures.push("codex 非目标但 config.toml 被创建".to_string());
    } else {
        println!("[e2e]   codex: 非目标，未写入（符合预期）");
    }
    if wanted("gemini") {
        check_live(&gemini_file, "gemini", &base, &model, &mut failures);
    } else if gemini_file.exists() {
        failures.push("gemini 非目标但 .env 被创建".to_string());
    } else {
        println!("[e2e]   gemini: 非目标，未写入（符合预期）");
    }
    if !failures.is_empty() {
        return Err(format!("live 文件校验失败: {}", failures.join("; ")));
    }

    // ── 清理：吊销分组令牌（默认）+ 登出 ──────────────────────────
    println!("[e2e] 步骤 6/6 清理 …");
    if let Ok(Some(acc)) = state.db.get_relay_account() {
        for (g, t) in &acc.group_tokens {
            if keep_token {
                println!("[e2e]   保留令牌 relaydesk-{g} (id={})", t.token_id);
                continue;
            }
            match revoke_token(&acc.base_url, &acc.access_token, t.token_id).await {
                Ok(()) => println!("[e2e]   已吊销令牌 relaydesk-{g} (id={})", t.token_id),
                Err(e) => println!("[e2e]   吊销令牌 relaydesk-{g} 失败: {e}"),
            }
        }
    }
    RelayService::logout(&state).map_err(|e| format!("logout: {e}"))?;
    println!("[e2e] PASS — 端到端链路全部通过");
    Ok(())
}

/// 校验 live 文件存在且包含预期的 base_url / 模型 / sk- key；输出脱敏摘要
fn check_live(path: &Path, name: &str, base: &str, model: &str, failures: &mut Vec<String>) {
    let display = path.display().to_string();
    let Ok(content) = std::fs::read_to_string(path) else {
        failures.push(format!("{name}: {display} 不存在"));
        return;
    };
    let has_base = content.contains(base.trim_start_matches("https://"));
    let has_model = content.contains(model);
    let has_key = content.contains("sk-");
    println!(
        "[e2e]   {name}: {} ({}B) base_url={} model={} sk-key={}",
        display,
        content.len(),
        has_base,
        has_model,
        has_key
    );
    if !(has_base && has_key) {
        failures.push(format!(
            "{name}: base_url={has_base} sk-key={has_key} model={has_model}"
        ));
    }
}

async fn revoke_token(base: &str, access_token: &str, id: i64) -> Result<(), String> {
    let resp = reqwest::Client::new()
        .delete(format!("{}/api/token/{}", base.trim_end_matches('/'), id))
        .header("Authorization", format!("Bearer {access_token}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {}", resp.status()))
    }
}
