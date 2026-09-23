# RelayDesk A / C UI Implementation Plan

> Execution in the current workspace as explicitly requested. Preserve uncommitted work; no checkout/reset/clean. Approved A globally and C for login/install confirmation. Use executing-plans with bounded chart implementation in parallel.

**Goal:** Apply the approved visual system to the actual renderer, preserving all API and session behavior.

**Architecture:** Keep existing rd-\* classes and Action/Dialog/Switch. Define palette, surfaces, typography, spacing and elevation in tokens.css; consolidate desktop composition in polish.css. Keep page data and native operations unchanged.

**Tech Stack:** React, CSS variables, Radix, existing Recharts, Vite, Vitest.

- [x] Foundation: add bundled Inter variable Latin WOFF2 + OFL license, system CJK fallback; define teal tonal scale, semantic surface/gradient/glass tokens, font sizes 12/13/14/16/24/32, weights 400/500/600, 8px action gaps. Files: design/tokens.css, design/fonts.css, assets/fonts, design/brand.css. Fonts load locally with swap, no runtime CDN.
- [x] Global composition: rewrite design/polish.css as the final shared styling layer. Align header/content widths, tinted canvas, glass on large grouped panels only, solid action/dialog layers, consistent 40px controls and 44px primary actions. Compact navigation at short heights; no global horizontal scrolling. Preserve skip link, focus and reduced motion.
- [x] Login C: in auth/LoginPage.tsx keep username/password/submit contiguous, group registration/recovery below submit, put relay address in a quiet footer. Add theme selection before login using current ThemeProvider. Single focused form at small widths, restrained brand introduction at large widths. No password storage/security warning panel.
- [x] Install C: environment/InstallToolDialog.tsx and styles get one clear title, grouped install details and adjacent Cancel/Confirm actions. Keep loading/failure/success detection semantics and existing lifecycle calls.
- [x] Data panels: wallet summary/selection/checkout hierarchy; coherent usage filter/metric/chart/table panels; responsive model center, targets and environment groups. 900×600 scrolls inside main; 1440×900 uses purposeful columns.
- [x] Chart identity: UsageCharts.tsx uses the full model set to preserve per-model colors and non-color line/marker identities across sorting/filtering/refresh; tests cover these behaviors. Eight categorical colors have separate light/dark counterparts; no same-family inference.
- [x] Verify: run pnpm typecheck, full pnpm test:unit with bounded workers, pnpm build:renderer, git diff --check. Check local font bundling and locale key parity. CSS-only changes do not require new mirror tests; add behavioral tests for login theme if needed.
- [x] Visual: production renderer plus clearly marked synthetic IPC fixtures in a separate browser window. Inspect login, models, targets, wallet, usage, settings and deployment; sample zh/en, light/dark/system, 900×600/1000×650/1440×900, expanded/collapsed. Save screenshots and measured overflow/control/font evidence. Do not claim real payment, native restart or real-account data verification.
- [x] Record actual modified files, results and remaining native/platform limits in an interim review document. Final handoff only after user delivery approval.

## Execution evidence

- UI changes compared against the pre-edit snapshot, not HEAD. Production build and 1274 frontend tests passed.
- 216 functional-page layout combinations and 18 login combinations checked with the production renderer and synthetic IPC; screenshots and reports are under `docs/qa-2026-09-21/`.
- Follow-up fixes verified for 900px account grid sizing, short-height sidebar access, long balances and install confirmation spacing.
- See `docs/relaydesk-ui-a-review-2026-09-21.md` for exact files and remaining native/platform limitations. This is an interim review, not a final Handoff.
