# RelayDesk UI 验收与 Devin 交接简报

日期：2026-09-23
工作区：/Users/ilaohuyo/Documents/projects/RelayDesk/relaydesk
分支：codex/relaydesk-m1-ui
HEAD：6acc87b1a0c3cd30fc2d36175310336e6d799e4a（本次实现包含未提交改动，HEAD 不是交付内容的完整快照）。
状态：大量既有实现未提交；禁止 reset --hard、clean 或从 HEAD 覆盖现有代码。备份快照：09dd22ba。

## 交接结论

本轮由独立子智能体完成完整自动化验收，再由 GPT-6 Astra 做只读复核。核心范围（取消 Dock 动画、登出保留保存账号、应用重启后可显式选择保存账号、中英文多尺寸矩阵）有测试证据；Astra 未发现 Critical，但确认两个 Important 问题，因此当前状态为“可交接 Devin 修复”，不是全部完成或生产发布批准。

用户本轮明确反馈“保存登录账号密码目前没问题”，记录为用户人工确认，不据此推断 Windows/Linux 或全部重启路径已有自动化证据。云端 Devin 不能直接读取本机绝对路径：必须先同步当前工作区的源码、未跟踪文件与 docs；只拉取 HEAD 会丢失实现。本轮未创建或推送提交。

## 已验证的行为

1. 左侧导航已取消 Dock 放大、跟随鼠标、hover 浮层、transform 和过渡动画；保留静态悬停、当前项和折叠状态。
2. 勾选记住登录后，登出只清除当前会话；保存账号仍能在登录页显示并被显式选择。
3. 关闭并重新创建应用状态后，保存记录仍能读取，但不会自动登录；用户选择账号后才恢复会话，并进入模型中心。
4. 忘记账号会删除保存记录；过期凭据恢复失败会删除失效记录，网络失败保留记录以便重试。
5. 原始密码不在 renderer 或普通设置中持久化，也不写入报告；本轮未调用 OS Keychain。长期令牌位于应用目录的加密 vault，key 与密文同目录，安全等级依赖本机文件权限。
6. 登录、模型中心、部署、应用目标、钱包、用量、设置页面保留 RelayDesk rd-* 视觉体系与双语文案。

## 自动化验收证据

- TypeScript：tsc --noEmit，exit 0。
- 前端单测：148 个文件、1281 项通过。
- renderer production build：exit 0；主 JS 约 1,584 KB，gzip 约 489.27 KB。
- Rust 库：2957 passed、14 ignored，exit 0。
- cargo fmt --manifest-path src-tauri/Cargo.toml --check：exit 0。
- git diff --check：exit 0。
- visual-matrix.cjs：252 组合通过，errors=[]；覆盖中文/English、light/dark/system、900×600、1000×650、1440×900，以及登录页和已登录页面侧栏展开/折叠。横向溢出和控件裁切为 0，导航 transform/transition 为 none/0s。
- Astra 定向复核报告：App、desktopNavigation、api 共 51 项；walletUsage、restartTools 共 42 项通过。

证据文件：
- docs/qa-2026-09-23/subagent-acceptance-2026-09-23.md
- docs/qa-2026-09-23/astra-review-2026-09-23.md
- docs/qa-2026-09-23/README.md
- docs/qa-2026-09-23/results.json
- docs/qa-2026-09-23/screenshots/

## Devin 必须优先处理

### R1：钱包与用量会话过期没有同步全局登录状态

定位：src/relaydesk/account/WalletPage.tsx:95、src/relaydesk/account/UsagePage.tsx:83、src/relaydesk/state/useRelaySession.ts:104。

钱包配置、历史、报价和用量页面使用独立 query；useRelaySession 当前只监听模型/分组 query 的 expired。钱包或用量接口返回 401/403 时，后端会话可能已经清空，但 renderer 仍停留在已登录框架，只显示页面错误。统一鉴权失效处理，清除旧账号与 relaydesk 查询缓存并返回登录页；普通网络错误不得触发登出。补钱包配置/历史/报价、用量过期和重新登录后的缓存隔离测试。

验收标准：模拟钱包或用量任一请求过期后，当前页面回到登录页；旧余额、旧用量、旧账号不再可见；重新登录后只出现新账号数据。

### R2：工具启动成功后重启对话框仍使用旧 capabilities

定位：src/relaydesk/models/RestartToolsAction.tsx:228 及目标列表/确认阶段。

对话框只在挂载时获取能力。初始 running=false 的工具执行成功并返回 not_running_started 后，返回目标列表仍可能显示“启动”，再次确认缺少运行中风险。执行完成、返回列表和再次确认前都必须重新检测目标能力、运行状态和资格；检测失败不得沿用旧状态。补停止→启动成功→返回→运行中→再次确认、失败/过期、多目标隔离测试。

验收标准：首次启动显示启动语义；重新检测确认目标已运行后，列表显示重启、确认页显示中断风险；旧 operationId 或旧 app 事件不改变当前目标状态。

### R3：明确记住登录复选框的删除语义

当前 service.rs:230 的 remember=false 登录会删除同账号已有保存记录；失效恢复也会删除失效记录。已验证的是“主动登出不删除”。Devin 不得自行假设产品语义：若要求只有用户点击忘记账号才删除，调整实现并补测试；若保留取消勾选即取消保存，需在 UI 文案和 Handoff 中明确。

## 仍需补证

- 真实 Tauri 窗口中：勾选记住登录 → 登出 → 选择保存账号；完全退出应用 → 启动 → 选择保存账号。
- macOS 原生人工视觉与交互走查；Windows 和 Linux Desktop 原生矩阵。Linux Server 只验 CLI/手动指引及不支持桌面操作状态，不要求原生 GUI。
- 真实中转站账号仅可在用户确认恢复后进行，所有 agent 登录请求间隔至少 30 秒，禁止并发、自动重试、读取钥匙串或在报告中写入凭据。当前验收使用 synthetic IPC/HTTP。
- 逐张人工审美验收仍未完成；fontReady 只表示 document.fonts.status 已 loaded，不证明每个字体文件或字形实际使用。
- 当前 vault 的 key 与密文同目录，不等同 OS Keychain 或硬件凭据隔离；不要以安全为由恢复钥匙串访问。

## 不要做的事情

- 不要 reset --hard、clean、从 HEAD 重建覆盖当前实现。
- 不要把合成矩阵结果写成真实服务或跨平台原生通过。
- 不要保存或打印明文密码、access token、真实账号、订单或用量明细。
- 不要为正常用户登录加入 30 秒冷却；30 秒只约束 agent 操作真实账号的测试请求。
- 不要重新引入 OS Keychain、静默自动登录、自动重启、强杀进程或静默安装。

## Devin 完成后的复验命令

以下命令在仓库根目录执行；先安装既有锁定依赖。rtk 为本机命令代理，其他环境无 rtk 时运行其后的原始命令即可。视觉脚本依赖本机绝对路径的 Playwright runtime，并访问 http://127.0.0.1:3000/；Devin 必须先把脚本的 require 路径适配为其可用 Playwright，并启动 renderer（pnpm dev:renderer --host 127.0.0.1 --port 3000），不要把找不到本机 runtime 误报成产品回归。

- rtk node node_modules/typescript/bin/tsc --noEmit
- rtk node node_modules/vitest/vitest.mjs run --testTimeout=15000
- rtk node node_modules/vite/bin/vite.js build
- rtk cargo test --manifest-path src-tauri/Cargo.toml --lib
- rtk cargo fmt --manifest-path src-tauri/Cargo.toml --check
- rtk git diff --check
- rtk node docs/qa-2026-09-23/visual-matrix.cjs

完成 R1/R2 后，更新两份 QA 报告、截图和本 Handoff；把 Important 项变为有测试证据的 resolved，仍未验证的平台和真实账号边界必须保留。

## 可直接转给 Devin 的摘要

请在 /Users/ilaohuyo/Documents/projects/RelayDesk/relaydesk 当前工作区继续 RelayDesk UI 收尾。当前已完成并通过自动化验收：取消左侧 Dock 动画；记住登录在登出后保留账号、应用重启后可显式选择恢复；中英文、多主题、900×600/1000×650/1440×900、侧栏展开/折叠矩阵共 252 组通过；TypeScript、148 文件/1281 前端测试、renderer build、2957 Rust 测试、fmt 和 diff check 均通过。请先阅读 docs/qa-2026-09-23/subagent-acceptance-2026-09-23.md 与 docs/qa-2026-09-23/astra-review-2026-09-23.md。GPT-6 Astra 确认两项 Important：R1 钱包/用量 query 的 session_expired 未联动全局登录状态，可能停留在旧的已登录框架；R2 RestartToolsAction 在 not_running_started 成功后沿用旧 capabilities，返回列表可能仍显示“启动”并遗漏运行中风险。请补实现和回归测试，另外明确 remember=false 是否应删除已有保存账号；再补 macOS/Windows/Linux 原生和真实服务边界验收。禁止 reset/clean、真实账号并发登录、Keychain、明文凭据和把 synthetic 结果写成生产通过。完成后按文档命令重新验证并更新 Handoff。

## 文件范围提示

本轮验收相关：src/relaydesk/layout/Sidebar.tsx、src/relaydesk/design/brand.css、src/relaydesk/design/workspace.css、src/relaydesk/RelayDeskApp.tsx、src/relaydesk/auth/LoginPage.tsx、src/relaydesk/state/useRelaySession.ts、src-tauri/src/relay/service.rs、src-tauri/src/commands/relay.rs、tests/relaydesk/desktopNavigation.test.tsx、tests/integration/App.test.tsx，以及 docs/qa-2026-09-23/。工作区还有大量更早的 UI、Rust、API 和设计改动，交接时按 git status 区分，不要覆盖。

## 其他功能与接口资料

本轮完整测试不等于对全部历史功能做了真实业务验收。分组映射、安装/启动、重启、钱包支付、用量图表和环境医生的真实联调及平台支持应分别核对，禁止伪造不具备的检测或支付结果。保持 relayApi / Rust IPC 边界，不由 renderer 直接访问站点；保留应用成功与程序启动/重启独立结果、仅真实成功 targetApps 的资格、operationId + app 过滤以及纯说明帮助入口。

当前中转站为 https://www.shenlanqaq.com/。接口资料见 docs/relaydesk-account-usage-api-requirements-2026-09-20.md（以文档末尾最新更新为准）；已接入用量桶/日志、充值配置/报价/支付签名 POST/历史。待核对：统计时区/桶边界/缓存与 prompt_tokens 关系/分页一致性，支付幂等/单笔查询/报价过期/到账刷新；没有真实付款验收，不能创建支付或自动付款来冒充通过。
