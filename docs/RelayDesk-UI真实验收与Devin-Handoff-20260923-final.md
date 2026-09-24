# RelayDesk UI 真实验收与 Devin Handoff

日期：2026-09-23
工作区：/Users/ilaohuyo/Documents/projects/RelayDesk/relaydesk
分支：codex/relaydesk-m1-ui
备份快照：09dd22ba
状态：当前工作区包含大量未提交实现；没有执行 reset --hard、clean、覆盖 HEAD 或提交。

## 验收结论

本轮完成了真实中转站账号的 RelayDesk 原生桌面端登录和账号恢复验收，并完成真实 Tauri 窗口的中英文、多主题、多尺寸页面截图矩阵。核心登录与记住账号链路、钱包/用量过期联动和重启能力快照修复均已有代码与定向测试证据；钱包付款、工具安装和目标桌面端重启没有执行真实副作用操作，因此不能标记为业务完成。

测试账号凭据没有写入本简报、截图、日志或代码。真实账号请求按至少 30 秒间隔顺序执行；该间隔只约束测试操作，不会限制普通用户登录。

## 真实账号原生验收

账号登录使用当前站点 https://www.shenlanqaq.com/，通过 RelayDesk 登录表单完成，未绕过 renderer 直接写入会话。

已确认：

- 密码登录成功后进入模型中心。
- 模型中心从真实服务读取到账户余额、48 个可用模型和 11 个模型分组。
- 用量页切换到近 7 天后读取到真实记录：4 次请求、973 Token；页面显示时区为 Asia/Shanghai。
- 在设置页执行退出登录后，登录页保留“已保存登录账号”列表；点击保存账号无需再次输入密码即可进入模型中心。
- 完全退出 RelayDesk 并重新启动后，保存账号仍存在；显式点击该账号后成功恢复并进入模型中心。应用不会自动登录。
- 未调用 OS Keychain；密码没有保存到 renderer 或普通设置中。

未执行：真实付款、创建支付订单、工具安装、Codex/Claude.app 真实重启。它们属于有外部副作用的操作，仍需用户明确操作并单独验收。

## 原生视觉与交互矩阵

原生截图目录：docs/qa-2026-09-23/native/
索引：docs/qa-2026-09-23/native/capture-results.jsonl

共 216 张窗口截图，覆盖：

- 语言：简体中文、English
- 主题：浅色、深色、跟随系统
- 窗口：900×600、1000×650、1440×900
- 侧栏：展开、折叠
- 页面：模型中心、工具部署、应用目标、钱包与充值、用量统计、设置

截图通过真实 Tauri 窗口 ID 捕获，并以 OCR 记录页面文本；真实账号标识在截图和索引中已遮盖。由于截图工具在当前会话不会向模型稳定返回可辨认像素，像素级审美判断以截图文件交给 Devin/人工复核为准；本简报不把 OCR 或几何检查冒充完整人工审美批准。

补充合成布局矩阵仍保留在 docs/qa-2026-09-23/screenshots/，共 252 组，检查横向溢出、控件裁切、主题、双语和侧栏布局。

## 入口和状态检查

### 重启工具

- 模型中心头部有独立的“重启工具”主入口和 ? 说明入口。
- ? 入口仅展示支持范围、安全边界以及 Codex、Claude Code CLI、Claude.app、Gemini CLI 手动指引；原生窗口中确认没有“确认重启”按钮，也没有调用重启 API 的副作用。
- 未有成功模型应用时，主入口保持“还没有应用模型”语义，不会误触发重启。
- RestartToolsAction 已按 operationId + app 过滤进度事件，并在返回目标列表时重新读取能力，避免启动成功后继续使用旧的“启动”状态。

### 钱包与充值

- 原生钱包页显示余额、累计消费、充值金额、微信/支付宝选择和“去付款”入口。
- “去付款”交由官方收银台流程；本轮没有创建订单或打开真实支付页面。
- 钱包配置、历史、报价等 query 的 relay.session_expired 已通过 onSessionExpired 传播到全局会话处理；普通网络错误不触发登出。

### 用量统计

- 支持区间、模型筛选、图表形式、指标和时间粒度选择。
- 空数据不伪造图表；真实近 7 天窗口显示请求和 Token 汇总。
- 用量 query 的会话过期会返回登录态，避免旧账号数据继续留在已登录框架。

## 自动化验证结果

以下结果均来自本轮新运行的日志：

- TypeScript：TypeScript: No errors found，日志 docs/qa-2026-09-23/final-typecheck.log。
- 前端单测：148 个文件、1292 项通过；日志 docs/qa-2026-09-23/final-unit-direct.log。
- renderer production build：通过；主 JS 约 1,584.95 kB，gzip 约 489.55 kB；日志 docs/qa-2026-09-23/final-build-direct.log。
- Rust：2957 passed、14 ignored；日志 docs/qa-2026-09-23/final-rust.log。
- cargo fmt --manifest-path src-tauri/Cargo.toml --check：通过。
- git diff --check：通过。
- 合成视觉矩阵：252 组通过，脚本为 docs/qa-2026-09-23/visual-matrix.cjs。
- 原生视觉矩阵：216 张截图已生成，索引统计为 2 语言 × 3 主题 × 3 尺寸 × 2 侧栏 × 6 页面。

已知构建提示：Vite 报告主 chunk 大于 500 kB；不影响本轮构建退出码，后续可拆分代码块。pnpm 包管理器在依赖构建脚本审批检查时会报告 esbuild/msw ignored builds；使用已存在 node_modules 直接运行的 Vitest 和 Vite 命令均已通过。

## Devin 后续工作

1. 重新审阅真实原生截图，重点检查 900×600 下钱包、用量表格、图表切换、长文本、侧栏折叠和双语截断。
2. 在不改变 RelayDesk 现有 IPC 边界的前提下，补齐 Windows、Linux Desktop 和 Linux Server 的原生/CLI 验收；Linux Server 只验证手动指引和不支持桌面动作的状态。
3. 复核已完成的 R1：钱包配置/历史/报价、用量的 relay.session_expired 已联动全局登录，并保留普通网络错误不登出；定向钱包/用量测试已通过。
4. 复核已完成的 R2：RestartToolsAction 已在列表返回时刷新能力并按 operationId + app 过滤；定向重启测试已通过。
5. 明确 remember=false 的产品语义：当前普通密码登录未勾选会删除同账号已有保存记录，失效恢复也会删除失效记录；主动退出登录不会删除。若产品要求只有“忘记此账号”才删除，调整实现、文案和测试。
6. 继续保持：不读取或迁移 ~/.relaydesk，不恢复 OS Keychain，不由 renderer 直连中转站，不自动重启、强杀、静默安装或自动支付。

## 交付文件

- 真实验收 Handoff：docs/RelayDesk-UI真实验收与Devin-Handoff-20260923-final.md
- 原生截图：docs/qa-2026-09-23/native/
- 原生截图索引：docs/qa-2026-09-23/native/capture-results.jsonl
- 自动化验收结果：docs/qa-2026-09-23/README.md、results.json
- Astra 复核：docs/qa-2026-09-23/astra-review-2026-09-23.md
- 接口需求：docs/relaydesk-account-usage-api-requirements-2026-09-20.md
- 需求文档目录同步副本：/Users/ilaohuyo/Documents/projects/RelayDesk/需求文档/RelayDesk-UI真实验收与Devin-Handoff-20260923-final.md

## 可直接转给 Devin 的摘要

请在 /Users/ilaohuyo/Documents/projects/RelayDesk/relaydesk 当前工作区继续 RelayDesk UI 收尾，先阅读 docs/RelayDesk-UI真实验收与Devin-Handoff-20260923-final.md、docs/qa-2026-09-23/astra-review-2026-09-23.md 和 docs/qa-2026-09-23/native/capture-results.jsonl。本轮已用真实中转站账号完成 RelayDesk 原生登录、退出后保存账号恢复、完全重启后显式选择保存账号恢复；真实模型中心读取余额、48 个模型、11 个分组，真实近 7 天用量显示 4 次请求和 973 Token。已完成 216 张真实 Tauri 窗口矩阵截图（中英文 × 浅色/深色/系统 × 900×600/1000×650/1440×900 × 侧栏展开/折叠），另有 252 组合成布局矩阵。新鲜验证结果：TypeScript 通过；148 个文件、1292 项前端测试通过；renderer build 通过；Rust 2957 passed、14 ignored；fmt 和 diff check 通过。R1 钱包/用量 session_expired 联动和 R2 重启能力快照刷新、operationId/app 过滤已有实现与定向测试证据；请继续明确 remember=false 删除语义，并复核原生截图中的长文本和 900×600 布局。禁止 reset/clean、明文凭据、Keychain、自动登录、自动支付、静默安装、强杀或自动重启。
