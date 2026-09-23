# Workspace UI review — 2026-09-21

This is an iteration review record, not the final Handoff.

## Changes
- Model metrics use one continuous tonal band at supported desktop widths. The empty current-model state uses a compact row.
- Model table reserves a 112px action column and an 88px minimum button width. Chinese action labels remain horizontal; long model IDs wrap within their column.
- Wallet metrics share the same surface, label alignment and value baseline. Money uses 24px type; the timestamp uses readable 14px type on the same 30px line height.
- Amount and payment selection share one form. The checkout summary is a footer within that form, without a repeated heading or nested card. Refresh sits beside the form heading.
- Sidebar brand is enlarged; navigation is intentionally static with a small immediate hover surface only. There is no Dock layer, transform scaling, or transition, so pointer movement cannot cause layout or motion jank. No new dependencies were added.

## Verification
- TypeScript typecheck: passed.
- Renderer production build: passed; existing chunk-size and browser-data warnings remain. Framer Motion navigation raises the main bundle to approximately 526kB gzip.
- Relevant frontend tests: 51 passed (wallet, navigation and app integration). Existing theme IPC mock warnings remain.
- git diff --check: passed.
- Synthetic browser QA: 36 page layouts covering model center and wallet at 900×600, 1000×650, 1440×900, Chinese/English, light/dark/system. System changes, collapsed navigation, stationary hover hit areas, reduced motion, long model name and long amount checks passed.
- Screenshots and measured geometry: this directory; results.json records expanded page layouts.
- Screenshot capture succeeded, but the tool did not render the generated images back for human-like visual inspection. Automated geometry checks are not a substitute for final visual acceptance.
- Running Tauri development process was brought to the foreground. Its renderer uses the live Vite workspace. Native WebKit visual and motion acceptance remains for user review; no real login, payment, apply or restart actions were performed.

## Files
- src/main.tsx
- src/relaydesk/design/workspace.css
- src/relaydesk/design/polish.css
- src/relaydesk/layout/Sidebar.tsx
- src/relaydesk/models/CurrentModelCard.tsx
- src/relaydesk/account/WalletPage.tsx
- docs/qa-2026-09-21/workspace-review.cjs and generated review evidence

The existing uncommitted workspace was preserved. No commit or final delivery Handoff was created.
