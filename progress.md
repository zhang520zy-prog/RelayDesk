# Progress log

## 2026-09-20

- Re-read the existing wallet/usage plan and inspected the dirty worktree.
- Reproduced the remember-login issue in source: the control is explicitly disabled.
- Queried the public relay status endpoint and captured only non-sensitive currency/configuration fields.
- Attempted one authenticated login with the user-supplied test account; the relay returned its generic invalid-credentials response.
- Dispatched a read-only 5.6 Luna acceptance review agent per the user's task-allocation preference.

## 2026-09-20 冻结轮（Luna）

- Rust 库测试：2939 passed、14 ignored，exit 0。
- 定向前端验证：9 个文件、132 项中 131 项通过；唯一失败是 App 集成测试仍期待旧的“充值接口尚未就绪”标题，当前实现已渲染真实充值配置。
- TypeScript `tsc --noEmit` 通过。
- 已根据授权联调结果更新充值/用量 API 文档；未保存凭据、个人账单或订单数据，未点击付款。
- 支付 POST 表单桥接、真实重启记住登录验收、并发 session 边界和完整 CNY 汇率模式仍待后续轮次。

## 2026-09-21 A / C 全局 UI

- 已将确认的青绿单色渐变/轻玻璃 A 方案应用到实际 renderer，C 用于登录和安装确认。
- 本地 Inter Latin、主题 token、统一层级/间距、窄窗布局、钱包比例、模型图表颜色/线型/标记已实现。
- 148 文件 / 1274 前端测试、typecheck、renderer build、Prettier、git diff --check 通过；locale 494=494。
- 216 组功能页布局与 18 组登录布局已测量，截图和 JSON 在 docs/qa-2026-09-21/；数据全部为 synthetic IPC。
- 本轮未执行真实登录、支付、安装或重启；未改 Rust/API/认证策略，钥匙串与密码保存继续禁用。
- 原生 Tauri / Windows / Linux / OS 实时主题变化仍未作为本轮通过项。
- 当前审阅入口 docs/relaydesk-ui-a-review-2026-09-21.md。等用户确认可交付后再写最终 Handoff。

## 2026-09-21 登录网站入口变更

- 登录页官网入口更新为 https://yjapi.manqiaotechnology.com/958c19c404a5，并可点击打开。网页路径与 API origin 分离，未把入口路径拼到 /api 或模型地址上。
- 未认证 GET 新入口和原 /api/status 均返回 nginx 404，无法确认服务端可用性或 API 路径迁移；未尝试真实登录。注册与找回密码路径没有迁移证据，保持原路径。
- Typecheck、49 项相关测试、renderer build、git diff --check 通过。

## 2026-09-22 中转站域名迁移

- 新站点公开入口确认可用：`https://www.shenlanqaq.com/`、`/sign-in`、`/sign-up`、`/forgot-password` 与根路径 `/api/status` 均返回 200。
- 登录 API origin、登录页入口、注册/找回密码链接、充值官网和 E2E 默认地址已切换到新域名；旧域名路径重写仅保留给历史会话兼容，不会影响新域名。
- 49 项定向前端测试、148 个文件 / 1274 项前端全量测试、typecheck、renderer build、Rust 库测试（2949 passed、14 ignored）、cargo fmt 与 git diff --check 均通过。
- 未执行真实账号登录、支付或充值操作；当前开发版 RelayDesk 已启动，等待用户手动测试。

## 2026-09-22 记住登录与导航动画

- 已实现本机 AES-256-GCM 会话令牌保存，多账号选择恢复/移除；密码不落盘，未引入 OS Keychain API。关闭进程保留，主动退出删除当前账号。
- 侧栏改为常驻单层 hover、transform 平移和 CSS scale，支持 reduced-motion。
- 前端全量 148 文件 / 1280 tests 通过；最终小改动相关 67 tests、typecheck 再次通过。
- 最新 Rust lib 2957 passed / 14 ignored；renderer build、cargo fmt --check、git diff --check 通过。
- 本地 900×600 合成数据检查：无横向溢出、单一 hover 节点、reduced-motion transform none。截图位于 docs/qa-2026-09-21/remembered-login/。
- 未操作真实账号登录/充值。真实会话恢复、Windows/Linux 原生行为未验收；本地密钥与密文同目录，保护依赖系统用户文件权限。未生成最终 handoff，等待用户审阅。

## 2026-09-23 静态导航与记住登录修复

- 用户要求彻底取消 Dock：移除 hover state/移动浮层/scale/transition，保留静态选中与焦点。
- 修正主动登出删除 vault；现在保留账号，忘记账号才删除。恢复后回模型中心。
- 合成 HTTP 登录写盘、重新创建 AppState/vault 读取恢复、登出保留、忘记删除均通过。
- 148 文件 / 1281 前端测试；Rust 2957 passed / 14 ignored；typecheck、renderer build、fmt、diff check 通过。
- docs/qa-2026-09-23 包含 252 组合自动布局结果与截图；原生目视、真实账号恢复以及 Windows/Linux 仍未验收。
- 最新 Tauri dev 已启动，Vite http://127.0.0.1:3000；未生成最终 Handoff，待用户确认。

## 2026-10-01 RelayDesk 主界面通盘梳理与整改（Step 1-7）

- 依据 ui-ux-pro-max / ui-styling / design-system / brand 审计结论推进，逐步审验。
- Astra R1（钱包/用量会话过期同步）与 R2（重启能力快照刷新）确认当前代码已修复，50 项定向测试通过。
- 新增全局 `UpdateBanner`：检查中/有更新/已最新/未配置/检查失败/安装中/安装失败七态，启动 2s 自动检查；忽略按版本号持久化 localStorage，自动检查尊重忽略、手动检查不吞；异步回调函数式 set 防"忽略后复活"。
- 模型中心新增 `ModelTargetQuickBar`：Claude=Bot / Codex=Code / Gemini=Sparkles 图标 chip，状态色区分启用/已同步/失败/待同步；点击 chip 直达目标页并聚焦对应卡片（`focusTarget` + `is-focus` 光晕 + scrollIntoView）。
- `TargetsPage` 卡片图标由统一 Terminal 改为各 AI 语义图标；环境页 Windows 桌面端检测已放开（较早提交），本次修正其测试期望并把 unsupported 下载入口条件改为跨平台。
- 会话管理迁入主界面：新建 `src/relaydesk/sessions/SessionsPage.tsx` + `src/lib/api/relaydesk-sessions.ts`（复用 list_sessions/get_session_messages/delete_session/launch_session_terminal IPC，读 AI 工具真实会话文件，不碰 cc-switch 自有存储）。按 provider 分组、搜索过滤、消息详情、单条删除、终端恢复。未直接集成旧 `src/components/sessions/SessionManagerPage`（视觉体系不一致）。
- 前端按页面拆包：7 个页面组件 React.lazy + Suspense 骨架；主 chunk 1.60MB→1.17MB（gzip 495→369kB），UsagePage（recharts）383kB 独立按需加载。
- 图标规范落地：`src/relaydesk/` 全部 lucide-react；SessionsPage 本地 `ProviderIcon` 更名 `AiToolIcon` 避免与遗留 `ProviderIcon` 混淆。
- 新增 `assets/design-tokens.json`（与 tokens.css 对齐的三层 token 导出）与 `docs/brand-guidelines.md`（品牌/颜色/排版/组件/语气规范）。
- `src/App.tsx` 标记 LEGACY/DEPRECATED：主 bundle 已不含它，保留仅因 tests 与 lib 共享逻辑覆盖、且 P3 的 MCP/技能面板移植需要参考实现；不批量删除。
- 验证：typecheck、build:renderer、全量 148 文件 / 1296 tests 通过（中途修掉 3 处同步断言改为 findBy、1 处环境页测试按 Windows 检测新行为更新）、git diff --check 通过。
- 未验收：真机会话数据、Windows/Linux 原生行为、3.20.4 热更新端到端、真实账号链路。

## 2026-10-02 新手引导重定位 + 模型中心卡片化 + 会话过滤/布局整改（Step 8）

- 新手引导从模型中心迁至环境部署页顶部；侧栏环境部署置顶；"工具部署"更名"环境部署"；未跳过引导的新账号首登落环境页。
- 模型中心重构：工具栏仅留搜索；每分组一张卡——组名/计费/使用 + 组内模型下拉（默认选中当前在用模型）；单行紧凑布局，组名允许两行防截断。
- 环境页：Codex CLI 行更名「OpenAI Codex CLI」与桌面端区分；broken 状态新增「修复安装」入口；「查看指引」就地展开于该行下方（`rd-env-guide-row` li 占位同一网格列），不再跳页面底部；raw 后端错误不再上屏。
- 会话页：列表 240-280px + 详情 1fr，详情可经折叠按钮占满全宽；断点 900px→720px（此前按视口判定，千像素窗口即被上下堆叠——本次"又变挤"的根因）；消息 14px/1.7 行高 + hover 复制钮；删除按钮 hover/focus-within 显现；标题/摘要加 title tooltip。
- 会话消息过滤（后端）：Codex 跳过 developer/system 脚手架消息（app-context、技能清单——"全英文"元凶）与 user 注入块（AGENTS.md/environment_context/IDE 包装解包真实提问）；Claude 跳过 command-name/local-command-stdout/system-reminder/Caveat 包装。Codex+Claude 回归测试共 12 过。
- 代理修复保持：env_doctor `HTTPSProxy→http://`、`SOCKS→socks5h`（登录失败"连接失败"根因，此前复发是因为只修了 updater 未修 scheme 生成）。
- 钱包：金额按钮 54→44px/15px、方式行 52→44px（account.css 随懒加载后载入，之前盖掉 workspace 紧凑值）；订单号 rd-mono max-width+ellipsis 不换行。
- 反馈补强：apply 成功 toast「已把 X 应用到 A、B」（report 对象身份去重）；修复态安装对话框语境化（confirmToolRepair/repairConfirmationHint）。
- 统一走 copyText（原生 invoke+webview 兜底）替换裸 navigator.clipboard 4 处。
- 死代码清理：filters.group、modelChoices/ModelChoice、旧表格样式删除。
- i18n 单括号插值复发自查脚本揪出 confirmToolRepair/appliedToApps，已统一 {{}}；zh/en 各 568 键。
- 验证：typecheck ✅ 全量 149 文件/1302 测试 ✅ build:renderer ✅ fmt/diff-check ✅；Rust 会话测试 12/12 ✅。
- 经验沉淀：locale 加插值必须 {{}}；懒加载页面 CSS 后到会覆盖全局样式，密度类规则两边都得查；断点按视口换算成内容宽度再定阈值；Tauri 剪贴板统一走 copyText。

## 验收/回归经验（2026-10 追加）
- **"内容被裁切"先查容器链**：grid/flex 子元素默认 `min-width:auto`，宽内容会撑出视口——表格类布局一律 `> * { min-width: 0 }` + 内部滚动容器接管，别再只改表格内部
- **时间型测试夹具**：`create_time` 写死日期会随时间过期触发过期逻辑 → 用远期（2999）或相对 `Date.now()`
- **死代码清理方法**：从 `main.tsx` 沿 import 爬可达图（含 tests/ 作根、副作用 import、`import.meta.glob`），未达文件整批删；`@import` 的 CSS 与 fetch 加载的资源要人工复核白名单
- **new-api 日志语义**：`type=1` 充值到账（含兑换码）、`3` 管理员调整、`6` 退款；`type=0` 全量首页会被消费日志占满——必须分类型拉；后台直接改库不产生任何日志
