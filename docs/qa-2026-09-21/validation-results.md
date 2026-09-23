# Validation evidence — 2026-09-21

Production renderer with synthetic IPC; not real Tauri/account E2E.

## Typecheck — exit 0

```text
[WARN] Your node_modules are out of sync with your lockfile. Cannot check whether dependencies are outdated
$ tsc --noEmit
```

## Unit tests — exit 0

```text
(Use `node --trace-warnings ...` to show where the warning was created)
 ✓ tests/components/ProxyTabContent.apps.test.ts (1 test) 2ms

 Test Files  148 passed (148)
      Tests  1274 passed (1274)
   Start at  10:45:32
   Duration  49.83s (transform 2.00s, setup 13.47s, collect 9.58s, tests 36.63s, environment 19.14s, prepare 3.46s)

```

## Final renderer build — exit 0

```text
transforming...
Browserslist: browsers data (caniuse-lite) is 10 months old. Please run:
  npx update-browserslist-db@latest
  Why you should do it regularly: https://github.com/browserslist/update-db#readme
✓ 2494 modules transformed.
rendering chunks...
computing gzip size...
../dist/index.html                                         0.77 kB │ gzip:   0.45 kB
../dist/assets/relaydesk-mark-Pk2yiBuc.png                 4.79 kB
../dist/assets/inter-latin-wght-normal-Dx4kXJAl.woff2     48.26 kB
../dist/assets/index-BF3pl5-z.css                        170.03 kB │ gzip:  29.97 kB
../dist/assets/index-BBnYh6b1.js                       1,578.37 kB │ gzip: 487.94 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 2.00s
```

git diff --check: exit 0. Changed UI files pass Prettier. zh/en locale keys: 494 / 494, identical key sets.

Commands used pnpm --config.verify-deps-before-run=warn because the existing pnpm-workspace.yaml allowBuilds values are invalid for automatic dependency installation. The configuration was not changed.

The layout matrix preceded the final long-number wrapping and install-spacing refinements. These affected scenarios were then rechecked separately in long-values.json and install-final-layout.json.
