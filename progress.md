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
