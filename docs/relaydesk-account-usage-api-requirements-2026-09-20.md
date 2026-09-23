# RelayDesk 钱包与用量 API 验证契约

日期：2026-09-20。本文只记录当前授权联调已验证的站点接口和明确待办，不把猜测接口当作需求。

## 已验证接口

### 用量

`GET /api/data/self` 返回数组行，已确认字段：`model_name`、`created_at`、`use_group`、`count`、`token_used`、`quota`。RelayDesk 按模型和分组聚合这些值。站点当前未提供 input/output/cache 拆分，因此 UI 保持未知，不填零、不使用本地代理账单替代。请求区间由 Rust 限制为有效 RFC3339、结束晚于开始且不超过 32 天。

### 钱包配置

`GET /api/user/topup/info` 已确认返回在线充值开关 `enable_online_topup`、金额档位 `10/25/50/100/200/500/1000` 以及 `wxpay`、`alipay` 支付方式。Rust 归一化为钱包 DTO，renderer 不直接访问站点。

### 充值报价

普通 Epay 使用 `POST /api/user/amount`。请求金额必须为正整数；服务端响应形如 `{data: "98.00", message: "success"}`，其中 `data` 是服务端实付金额字符串。真实联调结果：10→10.00，100→98.00。客户端不使用固定汇率或本地金额回算。

### 历史

`GET /api/user/topup/self?p=&page_size=` 已确认历史记录字段 `money`、`create_time`、`status`；`success` 表示成功记录。个人记录不写入仓库或验证文档。

## 安全边界

- 长期 access token 只保留在进程会话；不传 renderer，不写普通设置。
- 充值与用量按当前会话账户隔离；401/403 清理对应会话。
- 官方钱包外链由 Rust 校验 HTTPS 与当前登录站点主机后打开。
- 未实现支付 POST 表单桥接，因此不创建订单、不保存表单、不执行付款，也不声称到账。

## 待确认或未实现

- 支付创建 POST 的表单字段、订单幂等键、订单单笔查询和到账轮询尚未接入。
- Stripe、Creem、Waffo 等其他支付方法尚未完成真实联调。
- 原生记住登录重启、密码变更导致 restore 失败时的启动行为、并发 session 边界和完整 CNY 汇率模式尚未验收。
- 本轮未做真实 Tauri 窗口端到端；900×600 中英文截图为 synthetic DOM 验证，未执行支付。
# 最新接口核对更新（2026-09-20）

已接入 /api/data/self 小时桶、/api/log/self 消费明细、/api/user/topup/info、/api/user/amount 整数报价、/api/user/pay 签名 POST、/api/user/topup/self 历史。图表和支付桥接已经实现，下方早期未实现结论已被此更新取代。

仍需站点明确：统计桶边界/时区、缓存与 prompt_tokens 的关系、分页快照一致性与覆盖水位；支付幂等键、单笔查询/过期、报价有效期与到账额度刷新。没有真实付款验收。登录最小间隔 30 秒，风险控制后当前暂停真实登录验证。此文档不是最终 Handoff。
