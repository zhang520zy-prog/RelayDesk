const {
  chromium,
} = require("/Users/ilaohuyo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const fs = require("node:fs");
const path = require("node:path");

const out = path.join(__dirname, "screenshots");
fs.mkdirSync(out, { recursive: true });
const sizes = [
  [900, 600],
  [1000, 650],
  [1440, 900],
];
const pages = [
  ["models", { zh: "模型中心", en: "Model center" }, ".rd-model-table"],
  ["deployment", { zh: "工具部署", en: "Tool deployment" }, ".rd-environment"],
  ["targets", { zh: "应用目标", en: "Sync targets" }, ".rd-targets-page"],
  ["wallet", { zh: "钱包与充值", en: "Wallet & top-up" }, ".rd-wallet-page"],
  ["usage", { zh: "用量统计", en: "Usage" }, ".rd-usage-page"],
  ["settings", { zh: "设置", en: "Settings" }, ".rd-settings"],
];

function slug(value) {
  return value.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

async function installMocks(page, language, theme, loggedOut = false) {
  await page.addInitScript(
    ({ language, theme, loggedOut }) => {
      localStorage.setItem("language", language);
      localStorage.setItem("relaydesk-theme", theme);
      const account = loggedOut
        ? null
        : {
            baseUrl: "https://relay.example.test",
            username: "review.account@example.test",
            userId: 7,
            quota: 56090000,
            usedQuota: 43910000,
            currencySymbol: "¥",
            currencyCode: "CNY",
            quotaPerUnit: 500000,
            displayInCurrency: true,
            updatedAt: 1789980180,
            group: "standard",
            applyApps: { claude: true, codex: true, gemini: true },
            groupTargets: { standard: "codex" },
            lastApplied: { group: "standard", model: "gpt-5.6-sol" },
          };
      const savedLogin = {
        id: "saved-a",
        username: "review.account@example.test",
        baseUrl: "https://relay.example.test",
        updatedAt: 1789980180,
      };
      const models = [
        {
          group: "OpenAI",
          ratio: 1,
          models: [
            "gpt-6-astra",
            "gpt-5.6-sol",
            "gpt-5.6-luna",
            "gpt-5.6-terra",
          ].map((id) => ({ id, modelRatio: 1, tags: ["tools"] })),
        },
        {
          group: "claude",
          ratio: 0.85,
          models: ["claude-sonnet-4", "claude-opus-4-6"].map((id) => ({
            id,
            modelRatio: 2.5,
            tags: [],
          })),
        },
      ];
      const usageRows = [
        {
          modelId: "gpt-5.6-sol",
          displayName: "GPT-5.6 Sol",
          group: "OpenAI",
          requestCount: 84,
          inputTokens: 181200,
          outputTokens: 74200,
          totalTokens: 255400,
          chargedQuota: 255400,
          successCount: 82,
          failedCount: 2,
          successRate: 0.976,
          detailsReconciled: true,
        },
        {
          modelId: "gpt-5.6-luna",
          displayName: "GPT-5.6 Luna",
          group: "OpenAI",
          requestCount: 63,
          inputTokens: 125400,
          outputTokens: 53100,
          totalTokens: 178500,
          chargedQuota: 178500,
          successCount: 63,
          failedCount: 0,
          successRate: 1,
          detailsReconciled: true,
        },
        {
          modelId: "gpt-5.6-terra",
          displayName: "GPT-5.6 Terra",
          group: "OpenAI",
          requestCount: 41,
          inputTokens: 89300,
          outputTokens: 37700,
          totalTokens: 127000,
          chargedQuota: 127000,
          successCount: 40,
          failedCount: 1,
          successRate: 0.976,
          detailsReconciled: true,
        },
        {
          modelId: "claude-sonnet-4",
          displayName: "Claude Sonnet 4",
          group: "claude",
          requestCount: 29,
          inputTokens: 47200,
          outputTokens: 19200,
          totalTokens: 66400,
          chargedQuota: 132800,
          successCount: 29,
          failedCount: 0,
          successRate: 1,
          detailsReconciled: true,
        },
      ];
      const callbacks = {};
      let nextId = 1;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener() {},
      };
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback(fn) {
          const id = nextId++;
          callbacks[id] = fn;
          return id;
        },
        unregisterCallback(id) {
          delete callbacks[id];
        },
        runCallback(id, payload) {
          callbacks[id]?.(payload);
        },
        async invoke(command, args = {}) {
          if (
            command === "relay_get_account" ||
            command === "relay_refresh_account"
          )
            return account;
          if (command === "relay_list_saved_logins")
            return loggedOut ? [savedLogin] : [];
          if (command === "relay_list_models") return models;
          if (command === "relay_list_groups")
            return models.map((item) => ({
              name: item.group,
              ratio: item.ratio,
            }));
          if (
            command === "relay_set_group_target" ||
            command === "relay_set_apply_apps"
          )
            return account;
          if (command === "relay_get_restart_capabilities") return [];
          if (command === "relay_get_topup_info") {
            return {
              enabled: true,
              currencySymbol: "¥",
              currency: "CNY",
              amountOptions: [10, 50, 100, 500, 1000],
              payMethods: [
                {
                  id: "wxpay",
                  label: language === "zh" ? "微信支付" : "WeChat Pay",
                  enabled: true,
                },
                {
                  id: "alipay",
                  label: language === "zh" ? "支付宝" : "Alipay",
                  enabled: true,
                },
              ],
            };
          }
          if (command === "relay_calculate_topup_amount")
            return {
              amount: args.amount,
              payAmount: args.amount,
              currencySymbol: "¥",
              currency: "CNY",
            };
          if (command === "relay_list_topup_history")
            return { items: [], total: 0, isComplete: true };
          if (command === "relay_get_usage_models") {
            return {
              items: usageRows,
              buckets: usageRows.flatMap((row, index) => [
                {
                  timestamp: 1789980000 - index * 3600,
                  modelId: row.modelId,
                  requestCount: row.requestCount,
                  totalTokens: row.totalTokens,
                  chargedQuota: row.chargedQuota,
                },
              ]),
              total: usageRows.length,
              isComplete: true,
              detailsStatus: "matched",
              asOf: "2026-09-23T10:00:00Z",
              timezone: "Asia/Shanghai",
            };
          }
          if (command === "relay_get_usage_summary")
            return {
              requestCount: 217,
              totalTokens: 627300,
              chargedQuota: 694700,
              isComplete: true,
              start: "2026-09-22T00:00:00Z",
              end: "2026-09-23T00:00:00Z",
            };
          if (command === "relay_detect_target_installations") {
            return [
              {
                app: "claude",
                cliPath: "/usr/local/bin/claude",
                desktopApp: null,
                desktopCandidates: ["Claude.app"],
                desktopName: "Claude.app",
              },
              {
                app: "codex",
                cliPath: "/usr/local/bin/codex",
                desktopApp: null,
              },
              {
                app: "gemini",
                cliPath: "/usr/local/bin/gemini",
                desktopApp: null,
              },
            ];
          }
          if (command === "get_tool_versions") {
            return ["claude", "codex", "gemini"].map((name) => ({
              name,
              version: "1.0.0",
              latest_version: null,
              error: null,
              installed_but_broken: false,
              env_type: "macos",
              wsl_distro: null,
            }));
          }
          if (command === "relay_env_check") {
            return [
              { id: "git", status: "ok", detail: "git 2.45.0" },
              { id: "python", status: "ok", detail: "Python 3.12.5" },
              {
                id: "node",
                status: "ok",
                detail: "Node.js 22.11.0 / npm 10.9.0",
              },
              { id: "writable", status: "ok" },
              { id: "relay", status: "ok", detail: "relay.example.test" },
              { id: "proxy", status: "ok", detail: "No proxy detected" },
            ];
          }
          if (command === "get_config_dir")
            return `/Users/review/.config/${args.app ?? "relaydesk"}`;
          if (command === "get_app_config_path")
            return "/Users/review/Library/Application Support/RelayDesk/config.json";
          if (command === "relay_get_tool_install_plan")
            return {
              app: args.app,
              source: "synthetic source",
              command: `install-${args.app}`,
              docsUrl: "https://example.test/docs",
            };
          if (
            command === "relay_log_frontend_error" ||
            command === "relay_export_diagnostics"
          )
            return null;
          if (command === "plugin:event|listen") return nextId++;
          if (command === "plugin:window|is_focused") return true;
          return null;
        },
      };
    },
    { language, theme, loggedOut },
  );
}

async function waitForPage(page, selector) {
  try {
    await page.locator(selector).waitFor({ state: "visible", timeout: 10000 });
  } catch (error) {
    fs.writeFileSync(
      path.join(__dirname, "wait-failure.html"),
      await page.content(),
    );
    await page.screenshot({ path: path.join(__dirname, "wait-failure.png") });
    throw error;
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(80);
}

async function collectGeometry(
  page,
  pageId,
  language,
  theme,
  width,
  height,
  collapsed,
) {
  return page.evaluate(
    ({ pageId, language, theme, width, height, collapsed }) => {
      const rect = (selector) =>
        document.querySelector(selector)?.getBoundingClientRect().toJSON() ??
        null;
      const elements = [
        ...document.querySelectorAll('button, [role="button"], input, select'),
      ];
      const clippedElements = elements
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.width > 0 &&
            (element.scrollWidth > element.clientWidth + 1 ||
              element.scrollHeight > element.clientHeight + 1 ||
              (box.right > innerWidth + 1 &&
                !element.closest(".rd-account-table-scroll")))
          );
        })
        .map((element) => ({
          text: element.textContent?.trim(),
          class: element.className,
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          height: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }));
      const transforms = [...document.querySelectorAll(".rd-nav-content")].map(
        (element) => getComputedStyle(element).transform,
      );
      const transitions = [...document.querySelectorAll(".rd-nav-item")].map(
        (element) => getComputedStyle(element).transitionDuration,
      );
      return {
        page: pageId,
        language,
        theme,
        width,
        height,
        collapsed,
        heading: document.querySelector("h1")?.textContent?.trim() ?? null,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        bodyOverflow: document.body.scrollWidth > innerWidth + 1,
        clippedControls: clippedElements.length,
        clippedElements,
        main: rect(".rd-content"),
        sidebar: rect(".rd-sidebar"),
        navTransforms: transforms,
        navTransitions: transitions,
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontReady: document.fonts.status === "loaded",
      };
    },
    { pageId, language, theme, width, height, collapsed },
  );
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const results = [];
  const errors = [];
  for (const [width, height] of sizes) {
    for (const language of ["zh", "en"]) {
      for (const theme of ["light", "dark", "system"]) {
        const page = await browser.newPage({ viewport: { width, height } });
        page.on("pageerror", (error) =>
          errors.push(`${language}/${theme}/${width}: ${error.message}`),
        );
        await page.emulateMedia({
          colorScheme: theme === "light" ? "light" : "dark",
        });
        await installMocks(page, language, theme);
        await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" });
        await waitForPage(page, ".rd-model-table");
        const nav = page.locator(".rd-sidebar .rd-nav-item");
        for (const [pageId, labels, selector] of pages) {
          if (pageId !== "models") {
            await nav.filter({ hasText: labels[language] }).click();
            await waitForPage(page, selector);
          }
          const expanded = await collectGeometry(
            page,
            pageId,
            language,
            theme,
            width,
            height,
            false,
          );
          const expandedName = `${pageId}-${language}-${theme}-${width}x${height}-expanded.png`;
          await page.screenshot({ path: path.join(out, expandedName) });
          results.push({ ...expanded, screenshot: expandedName });
          if (
            expanded.overflow ||
            expanded.bodyOverflow ||
            expanded.clippedControls ||
            expanded.navTransforms.some((value) => value !== "none") ||
            expanded.navTransitions.some(
              (value) => value !== "0s" && value !== "0ms",
            )
          ) {
            throw new Error(
              `expanded layout failed: ${JSON.stringify(expanded)}`,
            );
          }
          const collapseLabel =
            language === "zh" ? "折叠导航" : "Collapse navigation";
          await page.getByRole("button", { name: collapseLabel }).click();
          await page.waitForTimeout(40);
          const collapsed = await collectGeometry(
            page,
            pageId,
            language,
            theme,
            width,
            height,
            true,
          );
          const collapsedName = `${pageId}-${language}-${theme}-${width}x${height}-collapsed.png`;
          await page.screenshot({ path: path.join(out, collapsedName) });
          results.push({ ...collapsed, screenshot: collapsedName });
          if (
            collapsed.overflow ||
            collapsed.bodyOverflow ||
            collapsed.clippedControls ||
            collapsed.navTransforms.some((value) => value !== "none") ||
            collapsed.navTransitions.some(
              (value) => value !== "0s" && value !== "0ms",
            )
          ) {
            throw new Error(
              `collapsed layout failed: ${JSON.stringify(collapsed)}`,
            );
          }
          const expandLabel =
            language === "zh" ? "展开导航" : "Expand navigation";
          await page.getByRole("button", { name: expandLabel }).click();
          await page.waitForTimeout(40);
        }
        await page.close();
        const loginPage = await browser.newPage({
          viewport: { width, height },
        });
        loginPage.on("pageerror", (error) =>
          errors.push(`login/${language}/${theme}/${width}: ${error.message}`),
        );
        await loginPage.emulateMedia({
          colorScheme: theme === "light" ? "light" : "dark",
        });
        await installMocks(loginPage, language, theme, true);
        await loginPage.goto("http://127.0.0.1:3000/", {
          waitUntil: "networkidle",
        });
        await waitForPage(loginPage, ".rd-login");
        const loginGeometry = await collectGeometry(
          loginPage,
          "login",
          language,
          theme,
          width,
          height,
          false,
        );
        const loginName = `login-${language}-${theme}-${width}x${height}.png`;
        await loginPage.screenshot({ path: path.join(out, loginName) });
        results.push({ ...loginGeometry, screenshot: loginName });
        if (
          loginGeometry.overflow ||
          loginGeometry.bodyOverflow ||
          loginGeometry.clippedControls
        ) {
          throw new Error(
            `login layout failed: ${JSON.stringify(loginGeometry)}`,
          );
        }
        if (
          !(await loginPage
            .getByRole("button", { name: /review\.account@example\.test/ })
            .count())
        ) {
          throw new Error("saved account is not visible on the login page");
        }
        const otherAccountLabel =
          language === "zh"
            ? "使用其他账号登录"
            : "Sign in with another account";
        await loginPage
          .getByRole("button", { name: otherAccountLabel })
          .click();
        const rememberLabel =
          language === "zh" ? "记住登录信息" : "Remember sign-in";
        await loginPage
          .getByRole("checkbox", { name: rememberLabel })
          .waitFor({ state: "visible" });
        const manualGeometry = await collectGeometry(
          loginPage,
          "login-manual",
          language,
          theme,
          width,
          height,
          false,
        );
        const manualName = `login-${language}-${theme}-${width}x${height}-manual.png`;
        await loginPage.screenshot({ path: path.join(out, manualName) });
        results.push({ ...manualGeometry, screenshot: manualName });
        if (
          manualGeometry.overflow ||
          manualGeometry.bodyOverflow ||
          manualGeometry.clippedControls
        ) {
          throw new Error(
            `manual login layout failed: ${JSON.stringify(manualGeometry)}`,
          );
        }
        await loginPage.close();
      }
    }
  }
  fs.writeFileSync(
    path.join(__dirname, "results.json"),
    JSON.stringify(
      { sizes, pages: ["login", ...pages.map(([id]) => id)], results, errors },
      null,
      2,
    ),
  );
  await browser.close();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    `Passed: ${results.length} page/theme/language/size/sidebar layouts; screenshots in ${out}`,
  );
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
