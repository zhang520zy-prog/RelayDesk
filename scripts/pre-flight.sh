#!/usr/bin/env bash
# RelayDesk 发布前复验 —— 覆盖所有已踩过的 CI 炸点。
# 用法: scripts/pre-flight.sh [--full]   (--full 额外跑 tsc + vite build)
set -uo pipefail
cd "$(dirname "$0")/.."
CI_MODE=0
for a in "$@"; do [ "$a" = "--ci" ] && CI_MODE=1; done

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
sec()  { echo; echo "== $1"; }

sec "1. tauri 配置 schema（scrollBarStyle 类非法属性会在这里炸）"
python3 - <<'PY'
import json, sys
VALID_WINDOW = {"label","title","width","height","minWidth","minHeight","maxWidth","maxHeight",
 "x","y","center","resizable","titleBarStyle","hiddenTitle","theme","visible","fullscreen",
 "maximized","minimizable","closable","focused","skipTaskbar","alwaysOnBottom","alwaysOnTop",
 "transparent","decorations","shadow","additionalBrowserArgs","visibleOnAllWorkspaces",
 "contentProtected","preventOverflow","dragDropEnabled","tabbingIdentifier","trafficLightPosition",
 "windowEffects","incognito","zoomHotkeysEnabled","browserExtensionsEnabled","useHttpsScheme",
 "devtools","acceptFirstMouse","backgroundColor","create","focus","proxyUrl","dataStoreIdentifier"}
ok = True
for name in ["src-tauri/tauri.conf.json","src-tauri/tauri.windows.conf.json","src-tauri/tauri.linux.conf.json"]:
    try:
        cfg = json.load(open(name))
    except Exception as e:
        print(f"  FAIL {name}: {e}"); ok = False; continue
    for w in cfg.get("app", {}).get("windows", []):
        for k in w:
            if k not in VALID_WINDOW:
                print(f"  FAIL {name}: 非法 window 属性 '{k}'"); ok = False
    nsis = cfg.get("bundle", {}).get("windows", {}).get("nsis", {})
    if nsis.get("installerHooks"):
        print(f"  info {name}: nsis.installerHooks = {nsis['installerHooks']}")
sys.exit(0 if ok else 1)
PY
[ $? -eq 0 ] && ok "三个 conf 均通过 schema 校验" || bad "conf schema 失败"

sec "2. NSIS 卸载钩子"
H=src-tauri/installer-hooks.nsh
if [ -f "$H" ]; then
  m=$(grep -c '^!macro ' "$H"); e=$(grep -c '^!macroend' "$H")
  [ "$m" -eq "$e" ] && ok "!macro/$e 配对 ($m)" || bad "!macro($m)/!macroend($e) 不配对"
  grep -q 'NSIS_HOOK_POSTUNINSTALL' "$H" && ok "NSIS_HOOK_POSTUNINSTALL 宏存在（Tauri 只认固定名）" || bad "缺少 NSIS_HOOK_POSTUNINSTALL"
else
  bad "$H 不存在（tauri.conf.json 引用了它）"
fi

sec "3. NPM 包 ↔ Rust crate minor 版本对齐（tauri-cli 2.11 硬检查）"
python3 - <<'PY'
import json, re, sys
deps = {**json.load(open('package.json')).get('dependencies',{}),
        **json.load(open('package.json')).get('devDependencies',{})}
lock = open('pnpm-lock.yaml').read()
resolved = {m.group(1): m.group(2) for m in
    re.finditer(r"'(@tauri-apps/[^@']+)@([^':]+)':", lock)}
crates = {m.group(1): m.group(2) for m in
    re.finditer(r'name = "(tauri[a-z-]*)"\nversion = "([^"]+)"', open('src-tauri/Cargo.lock').read())}
pairs = {'@tauri-apps/api':'tauri'}
for npm, spec in deps.items():
    if not npm.startswith('@tauri-apps/plugin-'):
        continue
    pairs[npm] = 'tauri-plugin-' + npm[len('@tauri-apps/plugin-'):]
bad = []
for npm, crate in pairs.items():
    nv, cv = resolved.get(npm), crates.get(crate)
    if not nv: bad.append(f"{npm} 未在 pnpm-lock 解析"); continue
    if not cv: continue  # 无对应 crate，检查器不管
    if nv.split('.')[:2] != cv.split('.')[:2]:
        bad.append(f"{npm}@{nv} vs {crate}@{cv} (minor 不一致)")
for b in bad: print("  FAIL", b)
if not bad: print("  npm↔crate minor 全部对齐:", ", ".join(f"{n.split('/')[-1]}→{resolved[n]}" for n in pairs))
sys.exit(1 if bad else 0)
PY
[ $? -eq 0 ] && ok "npm↔crate 对齐" || bad "存在 minor 不一致"

sec "4. 版本号一致性（latest.json 依赖产物文件名里的版本）"
PJ=$(python3 -c "import json;print(json.load(open('package.json'))['version'])")
TC=$(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['version'])")
CT=$(grep -m1 '^version' src-tauri/Cargo.toml | cut -d'"' -f2)
if [ "$PJ" = "$TC" ] && [ "$TC" = "$CT" ]; then ok "version = $PJ 三处一致"; else bad "不一致: pkg=$PJ conf=$TC cargo=$CT"; fi

sec "5. Rust toolchain 钉版一致"
RT=$(grep 'channel' rust-toolchain.toml | cut -d'"' -f2)
WF=$(grep -h 'rust-toolchain@' .github/workflows/*.yml | grep -o 'rust-toolchain@[^ ]*' | sort -u)
echo "  rust-toolchain.toml: $RT | workflows: $(echo $WF)"
NWF=$(echo "$WF" | grep -vc "sha\|1.90" || true)
echo "$WF" | grep -q "1.90" && ok "workflow 钉 1.90" || bad "workflow 未钉 1.90"
[ "$RT" = "1.90" ] && ok "rust-toolchain.toml = 1.90" || bad "toml = $RT"

sec "6. 更新器配置"
python3 - <<'PY'
import json,sys
c = json.load(open('src-tauri/tauri.conf.json'))
u = c.get('plugins',{}).get('updater',{})
b = c.get('bundle',{})
ok = bool(b.get('createUpdaterArtifacts')) and bool(u.get('pubkey')) and bool(u.get('endpoints'))
print('  bundle.createUpdaterArtifacts:', b.get('createUpdaterArtifacts'), '| pubkey len:', len(u.get('pubkey','')), '| endpoints:', u.get('endpoints'))
sys.exit(0 if ok else 1)
PY
[ $? -eq 0 ] && ok "updater 配置完整" || bad "updater 配置缺失"
grep -q 'bundle/macos/\*.app.tar.gz' .github/workflows/test-build.yml && ok "workflow 收集 .app.tar.gz" || bad "缺 .app.tar.gz 收集"
grep -q 'bundles: dmg,app' .github/workflows/test-build.yml && ok "macOS bundles 含 app target" || bad "macOS 缺 app target（无 .app.tar.gz 产物！）"
grep -q 'TAURI_SIGNING_PRIVATE_KEY:' .github/workflows/test-build.yml && ok "签名 env 注入" || bad "缺签名 env"
grep -q 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD' .github/workflows/test-build.yml && ok "签名密码 env 置空" || bad "缺密码 env"

if [ "$CI_MODE" -eq 0 ]; then
  sec "7. 本地签名冒烟测试（密钥可解码）"
  if [ -f ~/.tauri/relaydesk-updater.key ]; then
    rm -f /tmp/relaydesk-sign-test.bin.sig && echo "smoke" > /tmp/relaydesk-sign-test.bin
    TAURI_PRIVATE_KEY_PATH=~/.tauri/relaydesk-updater.key TAURI_PRIVATE_KEY_PASSWORD="" \
      node_modules/.bin/tauri signer sign /tmp/relaydesk-sign-test.bin >/dev/null 2>&1 \
      && [ -s /tmp/relaydesk-sign-test.bin.sig ] \
      && ok "私钥可解码并签名" || bad "私钥解码失败"
  else
    bad "~/.tauri/relaydesk-updater.key 不存在"
  fi

  sec "8. pnpm-lock 与 package.json 一致"
  PNPM=$(command -v pnpm || echo "/opt/homebrew/bin/npx --yes pnpm@10.12.3")
  $PNPM install --frozen-lockfile --lockfile-only --store-dir ~/Library/pnpm/store >/dev/null 2>&1 \
    && ok "frozen-lockfile 一致" || bad "lockfile 与 package.json 不一致（跑 pnpm install）"
fi

FULL=0; for a in "$@"; do [ "$a" = "--full" ] && FULL=1; done
if [ "$FULL" -eq 1 ]; then
  sec "9. 前端构建"
  node_modules/typescript/bin/tsc --noEmit >/dev/null 2>&1 && ok "tsc 0 错误" || bad "tsc 报错"
  node_modules/.bin/vite build >/dev/null 2>&1 && ok "vite build 成功" || bad "vite build 失败"
fi

echo; echo "================ 结果: $PASS 通过 / $FAIL 失败 ================"
[ "$FAIL" -eq 0 ]
