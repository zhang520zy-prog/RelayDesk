# RelayDesk 视觉矩阵验收 — 2026-09-23

本轮使用合成账号和 Tauri IPC mock，未连接真实中转站，也未读取真实账号、钥匙串或付款接口。矩阵脚本为 `visual-matrix.cjs`，结果明细在 `results.json`，截图在 `screenshots/`。

## 覆盖范围

- 页面：登录、模型中心、工具部署、应用目标、钱包与充值、用量统计、设置。
- 尺寸：`900×600`、`1000×650`、`1440×900`。
- 语言：简体中文、English。
- 主题：浅色、深色、跟随系统（系统主题按深色系统色彩方案运行）。
- 工作区：已登录页面分别检查侧栏展开和折叠；登录页检查已保存账号卡片。
- 状态：模型列表、环境检查、目标映射、钱包金额/支付方式、用量图表、设置页均使用完整合成数据；登录页检查账号选择、密码表单与记住登录复选框。mock 不足以证明原生权限弹窗行为；本轮代码未调用 OS Keychain。

## 结果

`visual-matrix.cjs` 通过 252 个组合：

- 216 个已登录页面组合（6 页面 × 2 语言 × 3 主题 × 3 尺寸 × 2 侧栏状态）。
- 36 个登录页面组合（已保存账号卡片和密码表单各 18 个）。
- 横向溢出：0；控件内部和横向裁切：0（长页面采用内部滚动，宽用量表保留横向滚动）；document.fonts.status 未就绪：0（仅加载队列状态，不等同指定字体实际使用证明）；导航 transform：0；导航 transition：0；页面错误：0。

运行方式：

```bash
node docs/qa-2026-09-23/visual-matrix.cjs
```

脚本默认访问 `http://127.0.0.1:3000/`，需要先启动 renderer dev server。

## 记住登录验证与修改

- 修正 logout 删除 vault 记录的问题：登出仅清理当前会话；“忘记此账号”、同账号不勾选记住的密码登录及失效恢复会删除对应保存记录。
- 恢复保存账号后进入模型中心，与普通登录保持一致。
- Rust 合成 HTTP 登录 → 加密 vault 写盘 → 丢弃旧 AppState/vault → 新建 AppState 从同目录读取 → 显式选择恢复 → 登出保留 → 忘记删除，测试通过。
- 失效凭据恢复失败并删除记录；网络错误保留记录以供重试。前端多账号选择、无密码传递、忘记账号、过期/安全错误展示与登出恢复路径通过。
- 未在真实服务上反复登录，未执行付款或安装。本地密钥与密文同目录的既有方案依赖系统用户文件权限，不能等同 OS 硬件凭据库保护。

## 构建与测试

- TypeScript typecheck：exit 0。
- 前端全量：148 文件、1281 项通过。
- renderer production build：exit 0；主 JS 1,584.00 kB / gzip 489.27 kB，仍有 chunk-size 和浏览器数据库过期提示。
- Rust lib：2957 passed、14 ignored；最终磁盘重开测试加强后再次全量通过。
- cargo fmt --check、git diff --check：exit 0。
- 补充旧 workspace-review：36 组合、长模型名/金额、系统主题明暗切换通过。
- 原生开发版构建成功并运行 target/debug/relaydesk；日志“主窗口已显示”，macOS AX 返回窗口 1024×666。未在该窗口执行真实账号登录恢复。

## 验证边界

这是迭代验收记录，不是最终 Handoff。252 组合为 Chromium renderer + 合成 IPC 的截图及布局测量，不代表 Windows/Linux 原生矩阵通过，也不代表真实中转站账户端到端验收通过。主智能体已抽查中英文登录、模型中心展开/折叠、钱包、用量和设置的代表性截图；仍未逐张完成人工审美验收，自动几何检查也不能替代原生交互验收。用户已授权生成新的 Devin Handoff，后续以 Handoff 与 Astra 复核为准。

## 本轮修改文件

- src/relaydesk/layout/Sidebar.tsx
- src/relaydesk/design/brand.css
- src/relaydesk/design/workspace.css
- src/relaydesk/RelayDeskApp.tsx
- src-tauri/src/relay/service.rs
- src-tauri/src/commands/relay.rs
- tests/relaydesk/desktopNavigation.test.tsx
- tests/integration/App.test.tsx
- docs/qa-2026-09-21/workspace-review.cjs、workspace-review/README.md 与重跑证据
- docs/qa-2026-09-23/（脚本、结果、截图、本记录）

所有修改保留在原未提交工作区，没有执行 reset、clean 或提交代码。
