# Findings

- `LoginPage` currently renders the remember checkbox with `disabled`; there is no credential-store backend.
- `RelayAccountInfo` only exposes raw quota values. `WalletPage`, `Sidebar`, and `ModelCenterPage` call `quotaToUsd()` and hard-code `$`.
- Public `/api/status` is reachable and currently reports `custom_currency_symbol: "¥"`, `quota_display_type: "CUSTOM"`, `quota_per_unit: 500000`, and `display_in_currency: true`.
- Authenticated top-up and usage calls are declared in TypeScript only; no matching Rust commands or relay client methods exist yet.
- An authorized test account later logged in successfully; no credential, token, or personal billing record was written to disk or output.
- Existing local usage APIs are separate from relay billing and must not be used as a silent fallback for the new usage page.

## 冻结轮验证更新（2026-09-20）

- `/api/data/self` 已确认返回 `model_name`、`created_at`、`use_group`、`count`、`token_used`、`quota`，没有 input/output/cache 拆分。
- 充值配置已确认在线充值字段、10/25/50/100/200/500/1000 档位和 wxpay/alipay；`/api/user/amount` 报价 10→10.00、100→98.00，金额为服务端字符串。
- 历史字段已确认 `money/create_time/status`，success 为成功记录；未写入个人记录。
- Rust 全量库测试和 TypeScript typecheck 通过；定向前端剩 1 个旧 App 集成断言失败。
- 未实现支付 POST 桥接，未执行付款；官方钱包 HTTPS 外链仍是唯一支付入口。
