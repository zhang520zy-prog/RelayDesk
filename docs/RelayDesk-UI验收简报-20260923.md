# RelayDesk UI 验收简报（2026-09-23）

承接 `RelayDesk-UI真实验收与Devin-Handoff-20260923-final.md`、`docs/qa-2026-09-23/astra-review-2026-09-23.md` 与 `docs/qa-2026-09-23/native/capture-results.jsonl` 的收尾复核。

## 一、原生截图复核（216 张矩阵）

抽查范围：900×600 全页面（模型中心/工具部署/应用目标/钱包/用量/设置）× 中/英 × 展开/折叠侧栏 × 浅色/深色，辅以 1000×650、1440×900 抽验。

### 通过项

- **900×600 最小尺寸**：六个页面首屏信息完整，无横向溢出、无控件重叠。模型表格分组名超长时按 `第三方官ke…` 截断（有省略号，属预期截断）。
- **侧栏折叠**：仅图标态布局稳定，无悬浮层/缩放副作用，主内容区宽度自适应正确。
- **深色/浅色/跟随系统**：三主题对比度一致，状态徽标（正常/可安装/警告）在深色下仍可辨。
- **英文长文案**：钱包（"Selected payment amount"、"The relay calculates the payable amount…"）、用量（"Charged quota / amount"）、部署页副标题均在 900×600 内完整显示，无裁切。
- **真实数据呈现**：余额 ¥10.00、可用模型 50、模型分组 11、近 7 天 4 请求 / 973 Token / ¥0.002062、时区 Asia/Shanghai —— 与真实账号读取一致。

### 发现并修复

- **部署页桌面端行名重复**：英文显示 "Claude desktop desktop"、中文 "Claude desktop 桌面端"——注册表 `display_name` 已含 "desktop"，渲染时又拼本地化后缀。修复为渲染前剥除尾部 `desktop` 再拼后缀，现为 `Claude desktop` / `Claude 桌面端`。改动：`src/relaydesk/environment/EnvironmentPage.tsx`，`environment.test.tsx` 20/20 通过。

### 复核边界声明

本轮为代理视觉抽查（约 30 张关键组合），216 张全集仍建议发布前由人工快速过一遍；OCR/几何检查已通过的部分未重复计入。

## 二、`remember=false` 语义（已修正并测试）

**最终语义**：

| 操作 | 对已存"记住登录"记录的影响 |
|---|---|
| 登录勾选"记住登录信息" | 保存/更新该账号记录 |
| 登录不勾选（`remember=false`） | **仅本次不保存，不动旧记录** |
| 点击"忘记此账号"（显式动作） | 删除所选记录 |
| 退出登录 | 不删除记录 |
| 保存账号恢复时服务端判过期 | 仅删除被拒绝的该条记录 |
| 恢复时网络失败 | 保留记录，允许手动重试 |

修正原因：旧实现中 `remember=false` 会顺带删除同账号已存记录，与界面上独立的"忘记此账号"动作语义冲突，用户不勾选一次就可能丢失已存账号。

改动：`src-tauri/src/relay/service.rs` 中 `login_session` 仅在 `remember=true` 时写记录；新增回归测试 `unremembered_login_preserves_existing_saved_account`。会话保存相关 8 项定向测试全绿。

## 三、R1 / R2 复核

- **R1 会话过期联动**：`WalletPage.tsx`、`UsagePage.tsx` 仅在后端错误映射为过期分类时调用共享 `onSessionExpired`，普通网络错误只显示错误不登出；通知去重、旧请求不污染新登录——实现与测试证据已核对。
- **R2 重启能力刷新**：`RestartToolsAction` 每次进入目标列表 `phase` 都重新查询 `relay_get_restart_capabilities`（含重启结果返回后）；进度事件按 `operationId + app` 双重过滤，忽略陈旧事件；主按钮是唯一执行入口，`?` 仅说明；"未运行→启动"区分 `not_running_started` 文案不冒称重启。restartTools 26/26、environment 20/20 通过。

## 四、Windows / Linux 验收

### 已验证（代码与测试层）

- **重启能力**：非 macOS 下 `desktop_shell_capability` 直接返回 `platform_unsupported`，`run_restart` 同样拒绝——不伪造成功、不暴露 macOS 专属动作。`find_desktop_app` 在非 macOS 编译期即返回 `None`。
- **桌面端检测**：Windows/Linux 上 `desktopApp`/`desktopName` 为空，UI 显示"暂不支持检测"（`envDesktopUnsupported`），不猜测安装状态；桌面下载按钮仅在 macOS `warn` 态出现，非 macOS 不渲染。
- **CLI 检测/安装**：`locate_tool_executable` 与登录 shell 探测跨平台；`relay_get_tool_install_plan` 对不支持安装的工具返回 `relay.install_unsupported`。
- **打包通道**：`.github/workflows/test-build.yml`（手动触发、Windows 2022、未签名 NSIS artifact）已就绪。

### 未执行（需平台环境/授权）

- Windows/Linux 原生窗口截图与人工走查——本机为 macOS，无对应环境。
- Windows NSIS 包实际安装体验——需推送触发工作流后在 Windows 真机验证。
- Linux Desktop/Server 真实运行——同上，需对应环境。

**验收结论**：Windows/Linux 的"诚实降级"路径已在代码与测试层验证（unsupported 状态而非伪造结果）；原生级验收是环境限制的待办项，不是已通过的声明。

## 五、本轮验证记录

| 检查 | 结果 |
|---|---|
| `cargo test --lib relay::service::tests::` | 23 passed |
| `cargo test --lib saved_` | 8 passed |
| `cargo fmt --check` | 通过 |
| `git diff --check` | 通过 |
| `tsc --noEmit` | 通过 |
| vitest restartTools + environment | 46 passed |

基线沿用：Rust 2957 passed / 14 ignored；前端 148 文件 / 1292 测试；renderer build 通过。

## 六、仍未执行的真实操作（边界保持）

- 真实付款/创建订单
- 真实工具安装
- Codex/ChatGPT.app 真实重启（ChatGPT.app 内可能有并行任务活跃会话）
- Claude.app 真实重启
- Windows/Linux 原生验收（受环境限制）

以上均需显式授权或对应平台环境后方可执行。
