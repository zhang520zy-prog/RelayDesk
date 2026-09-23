# GPT-6 Astra 复核记录 — 2026-09-23

来源：指定模型 gpt-6-astra 的独立子智能体 /root/astra_review；由主智能体据返回报告整理。本轮未修改生产代码，未执行真实登录、付款、安装或目标工具重启。

## 结论

**可交接 Devin 继续修复；不作为全部功能已完成或生产发布批准。** 未发现 Critical；确认两项 Important，需修复并补回归。

## 通过项

- Sidebar 无 hover 浮层、指针驱动位移或 scale；最终 CSS 导航 transition/transform 为 none。
- 保存账号不自动恢复；点击账号只向 IPC 发送 savedId。登出保留列表，恢复后进入模型中心。
- 完整基线：148 文件/1281 前端测试、2957 Rust 测试通过（14 ignored）、typecheck/build/fmt/diff 通过；252 个合成布局组合通过。
- Astra 另报告定向复跑：App、desktopNavigation、api 共 51 项；walletUsage、restartTools 共 42 项。此为审阅子智能体报告，完整基线以子智能体验收报告为准。

## Important 修复项

### R1 钱包、用量会话过期未同步至全局登录状态

定位：src/relaydesk/account/WalletPage.tsx:95、src/relaydesk/account/UsagePage.tsx:83、src/relaydesk/state/useRelaySession.ts:104。

页面独立 query 没有接入统一 expired 处理；仅模型/分组由 useRelaySession 监听。当钱包或用量接口单独发生过期时，后端可能已清空会话，renderer 仍显示已登录框架。统一鉴权失效处理，清除旧账号缓存，防止旧请求污染新登录。补钱包配置/历史/报价及用量过期集成测试；普通网络错误不得导致退出。

### R2 工具启动成功后的运行状态快照未刷新

定位：src/relaydesk/models/RestartToolsAction.tsx:228 及目标列表/确认阶段。

capabilities 仅在对话框挂载查询。初始 running=false、结果 not_running_started 后返回列表，仍使用旧状态；再次确认显示“启动”且省略运行中风险，后端却可能执行真实重启。应在返回列表/再次确认前重新检测真实能力、运行状态与资格；检测失败不得沿用旧执行状态。补停止→启动成功→返回→运行中→再次确认，以及失败/过期/多目标隔离测试。

## 语义与证据边界

- “只有忘记才删除”不准确：service.rs:230 的普通密码登录 remember=false 也删除该账号既有记录；失效恢复也会删除。明确通过的是“登出不删除”。未勾选记住的删除语义需明确产品约定并补测试。
- fontReady 只检查 document.fonts.status === loaded，不能证明指定字体字形实际使用或全部字体文件成功加载。
- 252 组合为 Chromium + synthetic IPC 几何检查；原生 macOS、Windows/Linux、人工视觉审美验收仍需补证。
- vault 密钥与密文同目录，依赖本机用户文件权限，不等同 OS 硬件凭据隔离；不得擅自恢复钥匙串。
- Rust manifest 位于 src-tauri/Cargo.toml；从仓库根目录复验必须使用 --manifest-path，不能直接运行 cargo test --lib 或 cargo fmt --check。

## Minor

大 JS chunk、过期 Browserslist/baseline 数据、MSW/React act 警告可后续维护，不能通过隐藏警告替代修复。
