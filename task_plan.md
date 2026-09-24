# RelayDesk account integration follow-up

> 历史计划说明（2026-09-21）：下文早期“OS credential store / remembered sign-in”目标已被用户后续要求废止。禁止恢复钥匙串、密码持久化或自动登录。当前任务执行 A 全局 + C 登录/安装确认，参见 `docs/superpowers/plans/2026-09-21-relaydesk-glass-implementation.md`。最终 Handoff 等用户确认交付后再编写。

## Goal

Make the existing RelayDesk account UI usable against the relay service: enable safe remembered sign-in through the OS credential store, carry the relay's real currency configuration into every balance/charge view, and implement honest Rust-side top-up and usage adapters without renderer-side network calls or guessed billing data.

## Phases

- [in_progress] Investigate the live relay contract and current Rust/renderer boundaries.
- [ ] Add secure credential-store preference and login restoration flow.
- [ ] Add relay status/currency normalization and replace fixed USD rendering.
- [ ] Add authenticated top-up and usage adapter commands with explicit unsupported states.
- [ ] Add tests, run required checks, and record visual/platform limits.
- [ ] Ask for delivery confirmation before producing the final Handoff brief.

## Constraints

- Preserve all existing uncommitted work; never reset, clean, or rebuild from HEAD.
- Renderer may call only Tauri/Rust relay commands; it must not call the relay URL directly.
- Never log, persist in ordinary settings, or return the supplied password.
- Server-provided amounts, currency, and final charges are authoritative; renderer never converts quota to a guessed currency.

## Errors Encountered

| Error | Attempt | Resolution |
|---|---|---|
| Test account login returned the relay's generic invalid-credentials response | POST `/api/user/login` with the supplied account | Treat as live-contract evidence; do not retry or expose credentials. Continue with endpoint/schema inspection and explicit limitation reporting. |

