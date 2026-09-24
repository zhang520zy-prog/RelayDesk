# RelayDesk 子智能体验收报告（2026-09-23）

本报告只记录验收证据，不修改生产代码，不执行 `reset`、`clean` 或提交，也没有连接真实账号、钥匙串、付款接口、安装器或真实目标工具。

## 实际验证命令

| 检查 | 实际命令 | 结果 |
| --- | --- | --- |
| TypeScript | `rtk node node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| 前端单测 | `rtk node node_modules/vitest/vitest.mjs run --testTimeout=15000` | 148 个文件、1281 项通过 |
| renderer 构建 | `rtk node node_modules/vite/bin/vite.js build` | exit 0；主 JS 1,584.00 kB，gzip 489.27 kB |
| Rust 库测试 | `rtk cargo test --manifest-path src-tauri/Cargo.toml --lib`（在仓库根目录） | 2957 passed、14 ignored，exit 0 |
| Rust 格式 | `rtk cargo fmt --manifest-path src-tauri/Cargo.toml --check`（在仓库根目录） | exit 0 |
| 差异空白 | `rtk git diff --check` | exit 0 |
| 视觉矩阵 | `rtk node docs/qa-2026-09-23/visual-matrix.cjs` | 252 组合通过，errors=[] |

单测输出包含既有 Browserslist/`baseline-browser-mapping` 过期提示、部分 MSW 未匹配 `set_window_theme`/`relay_list_saved_logins` 的 warning，以及 React `act(...)` 提示；没有失败测试。

## 需求矩阵

| 需求 | 状态 | 证据与边界 |
| --- | --- | --- |
| 左侧 Dock 动画完全移除 | 通过（自动） | `tests/relaydesk/desktopNavigation.test.tsx` 检查无 `.rd-nav-hover`、导航内容无 inline transform；`workspace.css`/`brand.css` 的导航 transition 与 transform 为 `none`；视觉矩阵测得 252 组合 `navTransforms` 为空/`none`、`navTransitions` 为 `0s`。 |
| 登出后保留保存账号 | 通过（合成 IPC/HTTP） | `tests/integration/App.test.tsx` 的 “keeps a remembered account available after an explicit logout”；Rust `RelayService::logout` 测试确认 vault 记录仍在。 |
| 完全重启后可选择保存账号 | 通过（合成 Rust） | `saved_session_survives_restart_but_requires_explicit_selection` 丢弃原 `AppState` 和 vault，再从同目录新建并读取；`restore` 不自动选中，保存账号可显式恢复。 |
| 登出保留、忘记账号删除记录 | 通过（合成 Rust/前端） | `relay_forget_login` 与对应集成测试；Rust 测试确认 forget 后记录为空。另有明确语义：普通密码登录不勾选“记住登录”时会清理该账号既有保存记录（见 `service.rs:230`），是否符合产品预期需确认。 |
| 保存登录不存密码/不调用 OS Keychain | 通过（静态/测试） | `LoginPage` 只将 `remember` 传给 IPC；renderer 测试确认不保存密码；`src-tauri/src/relay/credentials.rs` 明确使用应用目录 AES-256-GCM vault，无 OS credential store。 |
| 保存登录过期/网络失败边界 | 通过（合成） | Rust 测试分别确认过期删除被拒账号、网络失败保留账号；前端测试覆盖过期回到密码表单和安全错误文案。 |
| 中英文、多主题、多尺寸、侧栏展开/折叠 | 通过（自动布局） | `visual-matrix.cjs` 覆盖中文/English、light/dark/system、900×600/1000×650/1440×900；216 个已登录页面 + 36 个登录页面，共 252；横向溢出、控件裁切均 0；document.fonts.status 为 loaded，不等同指定字体实际使用证明。 |
| 真实原生窗口视觉走查 | 未验证 | 当前证据来自 Chromium renderer + 合成 IPC；不能将几何检查或截图生成等同为逐张人工审美验收。 |
| 真实中转站账号重登/完全重启恢复 | 未验证 | 按 AGENTS 规则没有反复登录真实账号；用户本轮人工确认保存账号流程可用，但没有将该结论扩写成自动化真实服务证据。 |
| Windows/Linux 原生矩阵 | 未验证 | 本轮只在本地 macOS 开发环境运行 renderer/Rust；没有 Windows/Linux runner 证据。 |

## 代码与安全抽查

- `Sidebar.tsx` 已移除 hover 状态、指针事件和浮层；保留静态 hover 背景、当前项标识和折叠按钮。
- `RelayDeskApp.tsx` 两个登录入口均在 `loginSaved` 成功后转到模型中心，不再回到登出前的设置页。
- `RelayService::logout` 只清空当前会话和数据库快照；保存账号通过 `relay_forget_login` 单独删除。
- `SavedLoginInfo` DTO 不含 token；持久化 vault 的 key 与密文位于应用目录，权限依赖本机用户文件权限，安全等级不能等同 OS 硬件凭据库。
- 未发现将 token/password 输出到上述截图结果或测试报告的行为；测试 fixture 使用合成 token/password。

## 发现的问题

### Critical

无。

### Important

1. **钱包/用量会话过期缺少全局处理**（静态发现）：`WalletPage.tsx:95`、`UsagePage.tsx:83` 的查询独立调用 relay API，未把 `session_expired` 交给 `useRelaySession.handleError`。后者只监听模型/分组查询过期。后台失效时可能继续展示旧的已登录框架，页面只显示加载失败。需添加鉴权错误联动与集成回归测试。
2. **重启后能力快照可能过期**（静态发现）：`RestartToolsAction.tsx:227` 只在打开执行对话框时查询 capabilities；`not_running_started` 成功后回列表仍使用初始 `running=false`。再次确认可能显示“启动”并省略运行中风险。需在返回列表或再次确认前重新检测，并补连续操作测试。
3. **取消记住登录的语义需确认**：`RelayService::login_session` 在 `remember=false` 时调用 `remove_remembered`，会删除该用户名/用户 ID 的既有保存记录。这可能是“取消保存”的合理语义，也可能与“登出后仍保留已保存账号”的产品预期冲突；应在 Handoff 中明确并补测试。
4. **真实原生端到端证据缺失**：当前没有 Windows/Linux 原生截图，也没有真实 Tauri 窗口中“退出 → 重启 → 选择账号”的完整自动化记录。应由后续 Devin/Astra 在隔离测试账号和不触发风控的前提下补录。
5. **人工视觉审美验收未完成**：截图已生成且布局自动检查通过，但本轮没有逐张完成人工审美验收，不能把自动几何结果写成逐张视觉通过。
6. **本地 vault 安全边界**：key 与密文同目录，依赖用户目录权限；如果产品要求 OS 级凭据隔离，需要单独的安全设计和用户授权，不应在本轮默认为等价替代。

### Minor

1. renderer 构建提示主 chunk 超过 500 kB，建议后续按页面拆分动态 chunk。
2. Browserslist 与 baseline browser 数据过期提示应在依赖维护窗口更新。
3. 测试环境存在少量 MSW 未匹配请求和 React `act(...)` 警告；不影响本轮 exit 0，但可在后续清理以降低噪音。

## 结论

自动化验收项全部通过，记住登录的登出保留和磁盘重启后显式选择已有合成证据，Dock 动画取消也有测试与矩阵证据。真实服务、跨平台原生、逐张人工视觉验收仍属于未验证项；本报告交给 Astra 审阅，按用户本轮授权生成 Devin Handoff 并明确列出这些待办。
