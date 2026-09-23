# 最新更正：统计口径与空字段（2026-09-20）

登录页已删除 session-only 说明段落。概览只展示官网模型分析提供的请求数、Token、费用，并与图表、模型表共用一次 /api/data/self 响应，不再独立请求第二份概览。

已定位并修正：日志按请求时间筛选、模型分析按小时桶时间筛选；日志改从实际首个统计桶开始读取。过去只要 count/quota/token 有一项不等，就隐藏该模型所有拆分；现在保留真实日志拆分，以 detailRequestCount 和 detailsReconciled 标记日志覆盖，行内提示，绝不冒充已核对。

整列均无数据则不渲染；删除无水位导致永远出现的笼统完整性警告，不改写 isComplete 为 true。日志读取失败/超限仍说明仅影响日志拆分。模型总量继续使用官网统计，不用日志替代。截图中 Astra 总量已存在，缺失的是拆分；不能据截图确定其具体差值，主账户对账未执行。

检查：TypeScript 通过；相关前端 45 项通过（旧说明断言修正后 walletUsage 11 项复跑通过，其他 34 项首轮通过）；Rust relay 64 passed / 5 ignored；renderer 和原生编译通过；diff check 通过。保留当前用户登录会话，未重启窗口，新后端下次启动生效。没有真实账号登录或钥匙串访问。

---

# 本轮更正：停用密码保存、图表改为单选

用户最新要求已覆盖下方早期记住登录方案。当前 RelayDesk 登录不读、写或删除系统钥匙串；keyring 依赖已移除，旧保存登录 IPC 也不会读取凭据。旧钥匙串条目不自动清理。仅保持进程内会话，重启需手动登录，30 秒节流保留。

图表改为分时曲线、柱状图、占比图三选一，只显示一个；时间粒度仅出现在曲线视图。Token 数据继续来自中转站接口，与钥匙串无关。

已编译并打开最新原生桌面进程。真实账号登录未执行。Rust relay 63 passed / 5 ignored，typecheck、renderer build、cargo fmt、git diff 检查通过。独立 Luna 复审再次因容量不足未完成。

---

# RelayDesk 钱包与用量验证记录

## 最新阶段更新（取代下方旧状态，非最终 Handoff）

- 用量已接入 /api/data/self 汇总和 /api/log/self 消费明细；分页最多 5,000 条、30 秒超时。请求数、Token、quota 核对后补充拆分，否则显示明确的失败/不全/未对齐状态。
- 已增加分时曲线、模型柱状图和占比环图，支持 Token/请求/消耗、小时/天及模型筛选，使用服务端时间桶。
- 支付已实现签名 POST 临时桥接，真实浏览器到达支付宝 ¥10 收银台。本轮早期创建两笔未支付测试订单，没有付款或到账验收。
- 钥匙串拒绝不再阻断成功登录；一次性登录不访问凭据库；恢复不再重复写入；保存原始登录标识；退出保留保存信息并提供显式复用与忘记入口。
- 登录最小间隔 30 秒，时间戳跨重启保留，禁止并发请求及自动重试。用户报告风险控制后已暂停真实登录及 Tauri 开发进程，后续须用户确认恢复并允许再测。
- 最新检查：TypeScript 与 renderer build 通过；完整前端 146 文件 / 1,257 项通过；Rust lib 2,947 通过 / 14 忽略。
- 900×600 synthetic 图表联动验证已进行；真实主账户统计对账、真实钥匙串重启/拒绝 E2E、付款到账与余额联动、完整尺寸主题矩阵仍未完成。Luna 复审容量不足。

以下为早期记录，冲突处以上述更新及当前代码为准。

日期：2026-09-20。验证针对当前冻结工作区进行，未写入凭据、个人账单或订单，也未执行付款。

## 当前状态

| 范围 | 当前实现与证据 | 未完成边界 |
| --- | --- | --- |
| 钱包入口与余额 | 侧栏、模型中心入口和钱包页；walletUsage、App 集成测试 | 无 |
| 充值配置 | Rust `relay_get_topup_info` 读取 `enable_online_topup`、10/25/50/100/200/500/1000 档位及 wxpay/alipay | 站点字段继续兼容演进 |
| 充值报价 | Rust 调用 `/api/user/amount`；报价金额使用服务端字符串，线路上强制正整数；10→10.00、100→98.00 已真实联调 | 其他支付方法按已提供契约扩展 |
| 支付 | 官方钱包 HTTPS 外链经过 Rust 校验 | 支付创建 POST 表单桥接未实现，未点击付款 |
| 历史 | 读取 `/api/user/topup/self`，适配 `money/create_time/status` | 未做单笔查单/到账轮询 |
| 用量 | `GET /api/data/self`，按 `model_name/created_at/use_group/count/token_used/quota` 聚合；缺失 input/output/cache 保持未知 | 原生 Tauri 真实端到端未做 |
| 登录 | 真实授权测试账号已登录成功；access token 不传 renderer、不写普通设置 | 原生记住登录重启、密码变更失败启动和并发 session 边界未验收 |
| 视觉 | 900×600 中英文钱包/用量 synthetic DOM 截图已保存，确认无外层溢出 | synthetic 截图不等同真实 Tauri 窗口 |

## 最终检查

- 完整前端 Vitest 最终复跑命令：`rtk proxy node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1`；145 files、1248 passed（全通过）。此前未限制并行度的运行曾出现资源争用导致 Pi 测试超时，低并发复跑已通过。
- Pi 定向复跑命令：`rtk proxy node node_modules/vitest/vitest.mjs run tests/components/PiProviderForm.test.tsx --maxWorkers=1 --minWorkers=1`；1 file、46 passed。
- Rust relay 子集：57 passed、5 ignored（2892 filtered out）。
- `rtk cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`rtk git diff --check` 和 TypeScript typecheck：通过。
- 未保存凭据、个人账单、订单或支付结果，未点击付款。
- 支付 POST 桥接、原生记住登录重启、密码变更后的 restore 行为、并发 session 边界和完整 CNY 汇率模式留待后续轮次。

任何不完整或未归因的用量字段均显示未知，不使用本地代理账单冒充站点账单。
