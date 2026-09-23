import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import i18n from "i18next";
import { server } from "../msw/server";
import { emitTauriEvent } from "../msw/tauriMocks";
import RelayDeskApp from "@/relaydesk/RelayDeskApp";
import { installRelayTranslations } from "@/relaydesk/i18n";
import { ThemeProvider } from "@/components/theme-provider";
import type { RelayAccountInfo, RelayApplyResult } from "@/lib/api/relay";

const initial: RelayAccountInfo = {
  baseUrl: "https://relay.example.test",
  username: "demo",
  userId: 7,
  quota: 5000000,
  usedQuota: 5000,
  currencyCode: "USD",
  currencySymbol: "$",
  quotaPerUnit: 500000,
  displayInCurrency: true,
  group: "standard",
  applyApps: { claude: true, codex: true, gemini: false },
  groupTargets: {},
  updatedAt: 1,
  lastApplied: { group: "standard", model: "old-model" },
};
let account: RelayAccountInfo | null;
let results: RelayApplyResult[];
let calls: Record<string, unknown>[];
let loginCalls: Record<string, unknown>[];
const post = (cmd: string, fn: Parameters<typeof http.post>[1]) =>
  http.post(`http://tauri.local/${cmd}`, fn);
function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider defaultTheme="dark" storageKey="relaydesk-theme">
        <RelayDeskApp />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}
beforeEach(async () => {
  localStorage.clear();
  installRelayTranslations();
  await i18n.changeLanguage("zh");
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  account = structuredClone(initial);
  results = [
    { app: "claude", ok: true },
    { app: "codex", ok: true },
  ];
  calls = [];
  loginCalls = [];
  server.use(
    post("relay_get_account", () => HttpResponse.json(account)),
    post("relay_saved_login_name", () => HttpResponse.json(null)),
    post("relay_list_saved_logins", () => HttpResponse.json([])),
    post("relay_refresh_account", () => HttpResponse.json(account)),
    post("relay_list_groups", () =>
      HttpResponse.json([
        { name: "standard", ratio: 1 },
        { name: "value", ratio: 0.6 },
        { name: "empty" },
      ]),
    ),
    post("relay_list_models", () =>
      HttpResponse.json([
        {
          group: "standard",
          ratio: 1,
          models: [
            { id: "new-model", tags: ["reasoning"], modelRatio: 1 },
            { id: "old-model" },
          ],
        },
        {
          group: "value",
          ratio: 0.6,
          models: [{ id: "new-model", description: "economical" }],
        },
        {
          group: "claude",
          ratio: 1,
          models: [{ id: "claude-sonnet-4" }],
        },
      ]),
    ),
    post("relay_set_apply_apps", async ({ request }) => {
      account = {
        ...account!,
        applyApps: (await request.json()) as RelayAccountInfo["applyApps"],
      };
      return HttpResponse.json(account);
    }),
    post("relay_set_group_target", async ({ request }) => {
      const body = (await request.json()) as {
        group: string;
        target: keyof RelayAccountInfo["applyApps"] | null;
      };
      const groupTargets = { ...account!.groupTargets };
      if (body.target) groupTargets[body.group] = body.target;
      else delete groupTargets[body.group];
      account = { ...account!, groupTargets };
      return HttpResponse.json(account);
    }),
    post("relay_apply_model", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.push(body);
      emitTauriEvent("relay-apply-progress", {
        requestId: body.requestId,
        stage: "syncing",
      });
      if (results.some((r) => r.ok))
        account = {
          ...account!,
          lastApplied: { group: String(body.group), model: String(body.model) },
        };
      return HttpResponse.json(results);
    }),
    post("relay_login", async ({ request }) => {
      loginCalls.push((await request.json()) as Record<string, unknown>);
      account = structuredClone(initial);
      return HttpResponse.json(account);
    }),
    post("relay_logout", () => {
      account = null;
      return HttpResponse.json(true);
    }),
    post("relay_check_update", () =>
      HttpResponse.json({ configured: false, version: null }),
    ),
    post("install_update_and_restart", () => HttpResponse.json(true)),
    post("relay_log_frontend_error", () => HttpResponse.json(null)),
    post("relay_get_restart_capabilities", () => HttpResponse.json([])),
    post(
      "relay_get_topup_info",
      () => new HttpResponse("relay.topup_not_ready", { status: 501 }),
    ),
    post(
      "relay_list_topup_history",
      () => new HttpResponse("relay.topup_not_ready", { status: 501 }),
    ),
    post(
      "relay_get_usage_models",
      () => new HttpResponse("relay.usage_models_not_ready", { status: 501 }),
    ),
    post(
      "relay_get_usage_summary",
      () => new HttpResponse("relay.usage_summary_not_ready", { status: 501 }),
    ),
    post("relay_env_check", () =>
      HttpResponse.json([
        { id: "git", status: "ok", detail: "2.45.0" },
        { id: "python", status: "warn", reason: "missing" },
        { id: "node", status: "ok", detail: "node 22.11.0 / npm 10.9.0" },
        { id: "writable", status: "ok" },
        { id: "relay", status: "ok", detail: "relay.example.test" },
        { id: "proxy", status: "ok", reason: "none" },
      ]),
    ),
    post("relay_get_tool_install_plan", async ({ request }) => {
      const { app } = (await request.json()) as { app: string };
      return HttpResponse.json({
        app,
        source: "synthetic source",
        command: `install-${app}`,
        docsUrl: "https://example.test/docs",
      });
    }),
    post("relay_detect_target_installations", () =>
      HttpResponse.json([
        { app: "claude", cliPath: "/usr/local/bin/claude", desktopApp: null },
        { app: "codex", cliPath: "/usr/local/bin/codex", desktopApp: null },
        { app: "gemini", cliPath: null, desktopApp: null },
      ]),
    ),
    post("get_config_dir", () => HttpResponse.json("/tmp/relaydesk-test/tool")),
    post("get_app_config_path", () =>
      HttpResponse.json("/tmp/relaydesk-test/config.json"),
    ),
    post("set_window_theme", () => HttpResponse.json(true)),
  );
});

describe("RelayDesk user flows", () => {
  it("preserves model search and group when navigating away and back", async () => {
    mount();
    const user = userEvent.setup();
    const search = await screen.findByRole("searchbox");
    await user.type(search, "codex");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "模型分组" }),
      "standard",
    );
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "模型中心" }));
    expect(screen.getByRole("searchbox")).toHaveValue("codex");
    expect(screen.getByRole("combobox", { name: "模型分组" })).toHaveValue(
      "standard",
    );
    expect(JSON.stringify(localStorage)).not.toContain("codex");
  });

  it("opens wallet and usage as separate pages with honest unavailable states", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "钱包与充值" }));
    expect(
      await screen.findByRole("heading", { name: "钱包与充值", level: 1 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "充值信息加载失败" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "创建支付订单" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "用量统计" }));
    expect(
      await screen.findByRole("heading", { name: "用量统计", level: 1 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "模型用量加载失败" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["relay_get_topup_info", "钱包与充值"],
    ["relay_list_topup_history", "钱包与充值"],
    ["relay_calculate_topup_amount", "钱包与充值"],
    ["relay_get_usage_models", "用量统计"],
  ])(
    "returns to login when %s reports an expired session",
    async (command, page) => {
      server.use(
        post("relay_get_topup_info", () =>
          HttpResponse.json({
            enabled: true,
            amountOptions: [10],
            payMethods: [{ id: "alipay", enabled: true }],
          }),
        ),
        post("relay_list_topup_history", () =>
          HttpResponse.json({ items: [], isComplete: true }),
        ),
        post("relay_calculate_topup_amount", () =>
          HttpResponse.json({ amount: 10, payAmount: 10 }),
        ),
      );
      server.use(
        post(
          command,
          () =>
            new HttpResponse("relay.session_expired secret-response", {
              status: 401,
            }),
        ),
      );
      const user = userEvent.setup();
      mount();
      await user.click(await screen.findByRole("button", { name: page }));
      expect(
        await screen.findByRole("button", { name: "登录 RelayDesk" }),
      ).toBeInTheDocument();
      expect(screen.getByText("登录已过期，请重新登录")).toBeInTheDocument();
      expect(screen.queryByText(/secret-response/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: page, level: 1 }),
      ).not.toBeInTheDocument();
    },
  );

  it("returns to login and keeps saved accounts after a wallet session expiry", async () => {
    server.use(
      post("relay_list_saved_logins", () =>
        HttpResponse.json([
          {
            id: "saved-demo",
            baseUrl: "https://relay.example.test",
            username: "saved-demo",
            userId: 17,
            updatedAt: 2,
          },
        ]),
      ),
      post(
        "relay_get_topup_info",
        () =>
          new HttpResponse("relay.session_expired private-wallet-detail", {
            status: 401,
          }),
      ),
      post("relay_list_topup_history", () =>
        HttpResponse.json({ items: [], isComplete: true }),
      ),
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "钱包与充值" }));
    expect(
      await screen.findByRole("heading", { name: "登录 RelayDesk", level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByText("saved-demo")).toBeInTheDocument();
    expect(screen.queryByText("$10.00")).not.toBeInTheDocument();
    expect(screen.queryByText(/private-wallet-detail/)).not.toBeInTheDocument();
  });

  it.each(["relay.session_expired", "relay.network"])(
    "handles checkout failure %s without exposing raw errors",
    async (error) => {
      server.use(
        post("relay_get_topup_info", () =>
          HttpResponse.json({
            enabled: true,
            amountOptions: [10],
            payMethods: [{ id: "alipay", enabled: true }],
          }),
        ),
        post("relay_list_topup_history", () =>
          HttpResponse.json({ items: [], isComplete: true }),
        ),
        post("relay_calculate_topup_amount", () =>
          HttpResponse.json({ amount: 10, payAmount: 10 }),
        ),
        post(
          "relay_create_topup_payment",
          () => new HttpResponse(error + " private-detail", { status: 401 }),
        ),
      );
      const user = userEvent.setup();
      mount();
      await user.click(
        await screen.findByRole("button", { name: "钱包与充值" }),
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "去付款" })).toBeEnabled(),
      );
      await user.click(screen.getByRole("button", { name: "去付款" }));
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "去付款",
        }),
      );
      if (error === "relay.session_expired") {
        expect(
          await screen.findByRole("button", { name: "登录 RelayDesk" }),
        ).toBeInTheDocument();
        expect(screen.getByText("登录已过期，请重新登录")).toBeInTheDocument();
      } else {
        expect(
          await within(screen.getByRole("dialog")).findByRole("alert"),
        ).toBeInTheDocument();
        expect(
          within(screen.getByRole("dialog")).getByRole("heading", {
            name: "确认充值订单",
          }),
        ).toBeInTheDocument();
      }
      expect(screen.queryByText(/private-detail/)).not.toBeInTheDocument();
    },
  );

  it("keeps a single wallet destination from the model balance summary", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "充值 ↗" }));
    expect(
      await screen.findByRole("heading", { name: "钱包与充值", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "充值" }).length,
    ).toBeGreaterThan(0);
  });

  it("opens tool deployment directly from navigation and keeps settings separate", async () => {
    server.use(post("get_tool_versions", () => HttpResponse.json([])));
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "工具部署" }));
    expect(
      await screen.findByRole("heading", { name: "工具部署", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "工具部署" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("heading", { name: "AI 工具" }),
    ).toBeInTheDocument();
    const git = screen.getByText("Git").closest("li")!;
    expect(await within(git).findByText("2.45.0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回模型中心" }));
    expect(
      screen.getByRole("heading", { name: "模型中心", level: 1 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(
      screen.queryByRole("heading", { name: "环境健康" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "检查环境" }),
    ).not.toBeInTheDocument();
  });
  it("keeps deployment in expanded and collapsed navigation without a duplicate header action", async () => {
    server.use(post("get_tool_versions", () => HttpResponse.json([])));
    const user = userEvent.setup();
    mount();
    const deployment = await screen.findByRole("button", { name: "工具部署" });
    expect(
      screen.queryByRole("button", { name: "部署工具" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新数据" })).toHaveAttribute(
      "title",
      "更新账户余额、模型列表和中转站分组；钱包与用量请在对应页面刷新",
    );
    await user.click(deployment);
    expect(
      screen.getByRole("heading", { name: "工具部署", level: 1 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "折叠导航" }));
    await user.click(screen.getByRole("button", { name: "模型中心" }));
    await user.click(screen.getByRole("button", { name: "工具部署" }));
    expect(
      screen.getByRole("heading", { name: "工具部署", level: 1 }),
    ).toBeInTheDocument();
  });
  it("routes the post-apply deployment link to the same top-level tool page", async () => {
    server.use(post("get_tool_versions", () => HttpResponse.json([])));
    const user = userEvent.setup();
    mount();
    const row = (await screen.findAllByRole("row")).find((r) =>
      r.textContent?.includes("new-model"),
    )!;
    await user.click(within(row).getByRole("button", { name: "使用" }));
    await user.click(
      await screen.findByRole("button", { name: "工具部署与环境检查" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "工具部署", level: 1 }),
    ).toBeInTheDocument();
  });
  it.each(["failure", "success"])(
    "discards a late apply %s after same-account relogin",
    async (outcome) => {
      let expire!: () => void;
      let finish!: () => void;
      const groupsGate = new Promise<void>((resolve) => {
        expire = resolve;
      });
      const applyGate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let firstGroups = true;
      server.use(
        post("relay_list_groups", async () => {
          if (firstGroups) {
            firstGroups = false;
            await groupsGate;
            return new HttpResponse("relay.session_expired", { status: 401 });
          }
          return HttpResponse.json([{ name: "standard" }]);
        }),
        post("relay_apply_model", async ({ request }) => {
          calls.push((await request.json()) as Record<string, unknown>);
          await applyGate;
          return outcome === "failure"
            ? new HttpResponse("relay.session_expired", { status: 401 })
            : HttpResponse.json(results);
        }),
      );
      const user = userEvent.setup();
      mount();
      const row = (await screen.findAllByRole("row")).find((r) =>
        r.textContent?.includes("new-model"),
      )!;
      await waitFor(() =>
        expect(within(row).getByRole("button", { name: "使用" })).toBeEnabled(),
      );
      await user.click(within(row).getByRole("button", { name: "使用" }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expire();
      await user.type(await screen.findByLabelText("邮箱或用户名"), "demo");
      await user.type(
        screen.getByLabelText("密码", { exact: true }),
        "new-session-password{Enter}",
      );
      await screen.findByRole("heading", { name: "模型中心", level: 1 });
      finish();
      await waitFor(() =>
        expect(
          screen.getAllByRole("button", { name: "使用" })[0],
        ).toBeEnabled(),
      );
      expect(
        screen.getByRole("heading", { name: "模型中心", level: 1 }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "查看详情" }),
      ).not.toBeInTheDocument();
      expect(account!.lastApplied?.model).toBe("old-model");
    },
  );

  it("blocks failed-tool retry until an account refresh finishes", async () => {
    results = [{ app: "codex", ok: false }];
    const user = userEvent.setup();
    mount();
    const row = (await screen.findAllByRole("row")).find((r) =>
      r.textContent?.includes("new-model"),
    )!;
    await user.click(within(row).getByRole("button", { name: "使用" }));
    await within(await screen.findByRole("dialog")).findByText("应用失败");
    await user.keyboard("{Escape}");
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    server.use(
      post("relay_refresh_account", async () => {
        await gate;
        return HttpResponse.json(account);
      }),
    );
    await user.click(screen.getByRole("button", { name: "刷新数据" }));
    await user.click(screen.getByRole("button", { name: "查看详情" }));
    const retry = within(await screen.findByRole("dialog")).getByRole(
      "button",
      { name: "重试该工具" },
    );
    expect(retry).toBeDisabled();
    await user.click(retry);
    expect(calls).toHaveLength(1);
    finish();
    await waitFor(() => expect(retry).toBeEnabled());
  });

  it.each(["success", "cancel", "missing"])(
    "handles diagnostics export: %s",
    async (outcome) => {
      let exports = 0;
      server.use(
        post("save_file_dialog", () =>
          HttpResponse.json(
            outcome === "cancel" ? null : "/tmp/synthetic-diagnostics.log",
          ),
        ),
        post("relay_export_diagnostics", async ({ request }) => {
          exports++;
          expect(await request.json()).toEqual({
            filePath: "/tmp/synthetic-diagnostics.log",
          });
          return outcome === "missing"
            ? new HttpResponse("relay.diagnostics_no_logs", { status: 500 })
            : HttpResponse.json({ filePath: "/tmp/synthetic-diagnostics.log" });
        }),
      );
      const user = userEvent.setup();
      mount();
      await user.click(await screen.findByRole("button", { name: "设置" }));
      await user.click(screen.getByRole("button", { name: "导出诊断日志" }));
      if (outcome === "success")
        expect(await screen.findByText("诊断日志已导出")).toBeInTheDocument();
      else if (outcome === "missing")
        expect(
          await screen.findByText("暂无可导出的诊断日志"),
        ).toBeInTheDocument();
      else {
        await waitFor(() =>
          expect(
            screen.getByRole("button", { name: "导出诊断日志" }),
          ).toBeEnabled(),
        );
        expect(screen.queryByText("诊断日志已导出")).not.toBeInTheDocument();
      }
      expect(exports).toBe(outcome === "cancel" ? 0 : 1);
    },
  );

  it("shows the new workspace and tolerates absent tags", async () => {
    mount();
    expect(
      await screen.findByRole("heading", { name: "模型中心", level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getAllByText("$10.00").length).toBeGreaterThan(0);
    expect(
      within(screen.getByRole("table")).getAllByText("new-model"),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "MCP" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("RelayDesk").length).toBeGreaterThan(0);
  });
  it("searches across groups and explains empty groups", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByRole("searchbox"), "economical");
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      2,
    );
    await user.clear(screen.getByRole("searchbox"));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "模型分组" }),
      "empty",
    );
    expect(
      await screen.findByText("当前账户在该分组没有可用模型"),
    ).toBeInTheDocument();
  });
  it("offers opt-in remembered sessions without reading legacy credentials", async () => {
    account = null;
    let savedCalls = 0;
    server.use(
      post("relay_saved_login_name", () => {
        savedCalls++;
        return HttpResponse.json("legacy-account");
      }),
    );
    mount();
    await screen.findByLabelText("邮箱或用户名");
    expect(
      screen.getByRole("checkbox", { name: /记住登录/ }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: "使用已保存信息登录" }),
    ).not.toBeInTheDocument();
    expect(savedCalls).toBe(0);
  });

  it("shows remembered accounts after remount and restores only the selected account without a password", async () => {
    account = null;
    const restored: unknown[] = [];
    server.use(
      post("relay_list_saved_logins", () =>
        HttpResponse.json([
          {
            id: "saved-a",
            username: "Alice",
            baseUrl: initial.baseUrl,
            updatedAt: 1,
          },
          {
            id: "saved-b",
            username: "Bob",
            baseUrl: initial.baseUrl,
            updatedAt: 2,
          },
        ]),
      ),
      post("relay_login_saved", async ({ request }) => {
        restored.push(await request.json());
        account = { ...initial, username: "Bob", remembered: true };
        return HttpResponse.json(account);
      }),
    );
    const first = mount();
    await screen.findByText("选择已登录账号");
    expect(restored).toEqual([]);
    first.unmount();
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Bob https/ }));
    expect(
      await screen.findByRole("heading", { name: "模型中心", level: 1 }),
    ).toBeInTheDocument();
    expect(restored).toEqual([{ savedId: "saved-b" }]);
    expect(loginCalls).toEqual([]);
  });

  it("removes a saved account without restoring it", async () => {
    account = null;
    let saved = [
      {
        id: "saved-a",
        username: "Alice",
        baseUrl: initial.baseUrl,
        updatedAt: 1,
      },
    ];
    const forgotten: unknown[] = [];
    server.use(
      post("relay_list_saved_logins", () => HttpResponse.json(saved)),
      post("relay_forget_login", async ({ request }) => {
        forgotten.push(await request.json());
        saved = [];
        return HttpResponse.json(null);
      }),
    );
    mount();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "忘记此账号: Alice" }),
    );
    await screen.findByLabelText("邮箱或用户名");
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(forgotten).toEqual([{ savedId: "saved-a" }]);
    expect(loginCalls).toEqual([]);
  });

  it("returns to password entry when the selected saved session expires", async () => {
    account = null;
    let expired = false;
    server.use(
      post("relay_list_saved_logins", () =>
        HttpResponse.json(
          expired
            ? []
            : [
                {
                  id: "saved-a",
                  username: "Alice",
                  baseUrl: initial.baseUrl,
                  updatedAt: 1,
                },
              ],
        ),
      ),
      post("relay_login_saved", () => {
        expired = true;
        return HttpResponse.json(
          { message: "relay.saved_login_expired" },
          { status: 500 },
        );
      }),
    );
    mount();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /Alice https/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "该账号的登录状态已失效",
    );
    expect(screen.getByLabelText("密码", { exact: true })).toHaveValue("");
    expect(loginCalls).toEqual([]);
  });

  it("shows safe saved-login errors and keeps manual sign-in available", async () => {
    account = null;
    server.use(
      post("relay_list_saved_logins", () =>
        HttpResponse.json([
          {
            id: "saved-a",
            username: "Alice",
            baseUrl: initial.baseUrl,
            updatedAt: 1,
          },
        ]),
      ),
      post("relay_login_saved", () =>
        HttpResponse.json(
          { message: "private-upstream-details" },
          { status: 500 },
        ),
      ),
    );
    mount();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /Alice https/ }),
    );
    await screen.findByRole("alert");
    expect(
      screen.queryByText("private-upstream-details"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "使用其他账号登录" }));
    expect(screen.getByLabelText("密码", { exact: true })).toBeEnabled();
    expect(loginCalls).toEqual([]);
  });

  it("submits login with Enter and hides the password", async () => {
    account = null;
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText("邮箱或用户名"), "demo");
    await user.type(
      screen.getByLabelText("密码", { exact: true }),
      "invented-password",
    );
    expect(screen.getByLabelText("密码", { exact: true })).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.getByRole("link", {
        name: "https://www.shenlanqaq.com/sign-in",
      }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("密码", { exact: true }), "{Enter}");
    expect(
      await screen.findByRole("heading", { name: "模型中心", level: 1 }),
    ).toBeInTheDocument();
    expect(loginCalls).toEqual([
      {
        baseUrl: "https://www.shenlanqaq.com/",
        username: "demo",
        password: "invented-password",
        remember: false,
      },
    ]);
  });
  it("shows a persistent failure and retries only the failed tool", async () => {
    results = [{ app: "codex", ok: false, error: "secret raw backend detail" }];
    const user = userEvent.setup();
    mount();
    const row = (await screen.findAllByRole("row")).find((r) =>
      r.textContent?.includes("new-model"),
    )!;
    await user.click(within(row).getByRole("button", { name: "使用" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("应用失败")).toBeInTheDocument();
    expect(
      screen.queryByText("secret raw backend detail"),
    ).not.toBeInTheDocument();
    results = [{ app: "codex", ok: true }];
    await user.click(
      within(dialog).getByRole("button", { name: "重试该工具" }),
    );
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].targetApps).toEqual(["codex"]);
    expect(account!.applyApps).toEqual(initial.applyApps);
    expect(await within(dialog).findByText("已应用")).toBeInTheDocument();
  });
  it("routes a claude group model to Claude Code only", async () => {
    const user = userEvent.setup();
    mount();
    const row = (await screen.findAllByRole("row")).find((r) =>
      r.textContent?.includes("claude-sonnet-4"),
    )!;
    await user.click(within(row).getByRole("button", { name: "使用" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].targetApps).toEqual(["claude"]);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("同步成功");
    expect(within(dialog).getAllByText("Claude Code").length).toBeGreaterThan(
      0,
    );
    expect(within(dialog).queryByText("Gemini CLI")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("OpenAI Codex")).not.toBeInTheDocument();
  });
  it("retains the previous model when all tools fail", async () => {
    results = [
      { app: "claude", ok: false },
      { app: "codex", ok: false },
    ];
    const user = userEvent.setup();
    mount();
    const row = (await screen.findAllByRole("row")).find((r) =>
      r.textContent?.includes("new-model"),
    )!;
    await user.click(within(row).getByRole("button", { name: "使用" }));
    expect(
      await screen.findByText("未能完成同步，保留上次成功应用的模型。"),
    ).toBeInTheDocument();
    expect(account!.lastApplied?.model).toBe("old-model");
  });
  it("does not apply with zero enabled targets", async () => {
    account!.applyApps = { claude: false, codex: false, gemini: false };
    const user = userEvent.setup();
    mount();
    const row = (await screen.findAllByRole("row")).find((r) =>
      r.textContent?.includes("new-model"),
    )!;
    await user.click(within(row).getByRole("button", { name: "使用" }));
    expect(
      await screen.findByText("请先启用至少一个应用目标"),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
  it("warns instead of applying when the inferred target is disabled", async () => {
    account!.applyApps = { claude: true, codex: false, gemini: false };
    const user = userEvent.setup();
    mount();
    const row = (await screen.findAllByRole("row")).find((r) =>
      r.textContent?.includes("new-model"),
    )!;
    await user.click(within(row).getByRole("button", { name: "使用" }));
    expect(await screen.findByText(/推荐的目标未启用/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
  it("saves target switches without applying a model", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "应用目标" }));
    await user.click(screen.getByRole("switch", { name: /Gemini CLI/ }));
    await waitFor(() => expect(account!.applyApps.gemini).toBe(true));
    expect(calls).toHaveLength(0);
  });
  it("persists a group target override and uses it on the next apply", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "应用目标" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "standard · 目标工具" }),
      "claude",
    );
    await waitFor(() => expect(account!.groupTargets.standard).toBe("claude"));
    await user.click(screen.getByRole("button", { name: "模型中心" }));
    const row = (await screen.findAllByRole("row")).find(
      (candidate) =>
        candidate.textContent?.includes("new-model") &&
        candidate.textContent?.includes("standard"),
    )!;
    await user.click(within(row).getByRole("button", { name: "使用" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].targetApps).toEqual(["claude"]);
  });
  it("blocks model writes while the initial account refresh is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      post("relay_refresh_account", async () => {
        await gate;
        return HttpResponse.json(account);
      }),
    );
    mount();
    const row = (await screen.findAllByRole("row")).find((r) =>
      r.textContent?.includes("new-model"),
    )!;
    expect(within(row).getByRole("button", { name: "使用" })).toBeDisabled();
    release();
    await waitFor(() =>
      expect(within(row).getByRole("button", { name: "使用" })).toBeEnabled(),
    );
  });

  it("serializes apply and keeps it running when Esc closes the dialog", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      post("relay_apply_model", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        calls.push(body);
        await gate;
        account!.lastApplied = {
          group: String(body.group),
          model: String(body.model),
        };
        return HttpResponse.json(results);
      }),
    );
    const user = userEvent.setup();
    mount();
    const row = (await screen.findAllByRole("row")).find((r) =>
      r.textContent?.includes("new-model"),
    )!;
    const button = within(row).getByRole("button", { name: "使用" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.dblClick(button);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(button).toHaveTextContent("正在准备访问凭据");
    act(() =>
      emitTauriEvent("relay-apply-progress", {
        requestId: "old-operation",
        stage: "syncing",
      }),
    );
    expect(
      within(screen.getByRole("dialog")).getByRole("status"),
    ).toHaveTextContent("正在准备访问凭据");
    act(() =>
      emitTauriEvent("relay-apply-progress", {
        requestId: calls[0].requestId,
        stage: "syncing",
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog")).getByRole("status"),
      ).toHaveTextContent("正在同步配置"),
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("正在同步配置");
    release();
    await waitFor(() => expect(button).toHaveTextContent("已应用"));
    expect(calls).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "查看详情" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
  it("keeps existing rows visible during refresh", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("table");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      post("relay_list_models", async () => {
        await gate;
        return HttpResponse.json([]);
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "刷新数据" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    release();
    expect(await screen.findByText("当前账户暂无可用模型")).toBeInTheDocument();
  });
  it("changes and persists the theme and logs out without applying", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "浅色" }));
    expect(document.documentElement).toHaveClass("light");
    expect(localStorage.getItem("relaydesk-theme")).toBe("light");
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    expect(
      await screen.findByRole("button", { name: "登录 RelayDesk" }),
    ).toBeInTheDocument();
    expect(account).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("keeps a remembered account available after an explicit logout", async () => {
    const saved = {
      id: "saved-a",
      username: "demo",
      baseUrl: initial.baseUrl,
      updatedAt: 1,
    };
    server.use(
      post("relay_list_saved_logins", () => HttpResponse.json([saved])),
      post("relay_login_saved", async ({ request }) => {
        expect(await request.json()).toEqual({ savedId: "saved-a" });
        account = { ...structuredClone(initial), remembered: true };
        return HttpResponse.json(account);
      }),
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByText("选择已登录账号")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /demo https/ }));
    expect(
      await screen.findByRole("heading", { name: "模型中心", level: 1 }),
    ).toBeInTheDocument();
  });
  it("keeps the user signed in when logout fails", async () => {
    server.use(
      post(
        "relay_logout",
        () => new HttpResponse("private backend details", { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "设置" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "退出登录" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("操作未完成");
    expect(
      screen.queryByText("private backend details"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "设置", level: 1 }),
    ).toBeInTheDocument();
  });

  it("reports the update service honestly when no endpoint is configured", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "设置" }));
    await user.click(await screen.findByRole("button", { name: "检查更新" }));
    expect(
      await screen.findByText("更新服务未配置；请从发布渠道手动获取新版本"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "更新并重启" }),
    ).not.toBeInTheDocument();
  });

  it("offers update-and-restart only after a version check succeeds", async () => {
    let installed = false;
    server.use(
      post("relay_check_update", () =>
        HttpResponse.json({ configured: true, version: "3.21.0" }),
      ),
      post("install_update_and_restart", () => {
        installed = true;
        return HttpResponse.json(true);
      }),
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "设置" }));
    await user.click(await screen.findByRole("button", { name: "检查更新" }));
    expect(await screen.findByText(/3\.21\.0/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更新并重启" }));
    await waitFor(() => expect(installed).toBe(true));
  });

  it("keeps the account when model loading fails", async () => {
    server.use(
      post(
        "relay_list_models",
        () => new HttpResponse("relay.network", { status: 500 }),
      ),
    );
    mount();
    expect(await screen.findByText("暂时无法加载模型")).toBeInTheDocument();
    expect(screen.getAllByText("$10.00").length).toBeGreaterThan(0);
  });
  it("returns to login on expired authentication without displaying raw errors", async () => {
    server.use(
      post(
        "relay_list_models",
        () => new HttpResponse("relay.session_expired", { status: 401 }),
      ),
    );
    mount();
    expect(
      await screen.findByRole("button", { name: "登录 RelayDesk" }),
    ).toBeInTheDocument();
    expect(screen.getByText("登录已过期，请重新登录")).toBeInTheDocument();
  });
});
