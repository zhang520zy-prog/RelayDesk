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
  group: "standard",
  applyApps: { claude: true, codex: true, gemini: false },
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
      ]),
    ),
    post("relay_set_apply_apps", async ({ request }) => {
      account = {
        ...account!,
        applyApps: (await request.json()) as RelayAccountInfo["applyApps"],
      };
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
    post("get_config_dir", () => HttpResponse.json("/tmp/relaydesk-test/tool")),
    post("get_app_config_path", () =>
      HttpResponse.json("/tmp/relaydesk-test/config.json"),
    ),
    post("set_window_theme", () => HttpResponse.json(true)),
  );
});

describe("RelayDesk user flows", () => {
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
    results = [
      { app: "claude", ok: true },
      { app: "codex", ok: false },
    ];
    const user = userEvent.setup();
    mount();
    const row = (await screen.findAllByRole("row")).find((r) =>
      r.textContent?.includes("new-model"),
    )!;
    await user.click(within(row).getByRole("button", { name: "使用" }));
    await within(await screen.findByRole("dialog")).findByText("部分应用失败");
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
    await user.click(screen.getByRole("button", { name: "刷新" }));
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
    expect(screen.queryByText("CC Switch")).not.toBeInTheDocument();
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
    expect(screen.getByText("https://yjapi.manqiaotechnology.com/")).toBeInTheDocument();
    await user.type(screen.getByLabelText("密码", { exact: true }), "{Enter}");
    expect(
      await screen.findByRole("heading", { name: "模型中心", level: 1 }),
    ).toBeInTheDocument();
    expect(loginCalls).toEqual([
      {
        baseUrl: "https://yjapi.manqiaotechnology.com/",
        username: "demo",
        password: "invented-password",
      },
    ]);
  });
  it("shows a persistent partial result and retries only the failed tool", async () => {
    results = [
      { app: "claude", ok: true },
      { app: "codex", ok: false, error: "secret raw backend detail" },
    ];
    const user = userEvent.setup();
    mount();
    const row = (await screen.findAllByRole("row")).find((r) =>
      r.textContent?.includes("new-model"),
    )!;
    await user.click(within(row).getByRole("button", { name: "使用" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("部分应用失败")).toBeInTheDocument();
    expect(
      screen.queryByText("secret raw backend detail"),
    ).not.toBeInTheDocument();
    results = [{ app: "codex", ok: true }];
    await user.click(
      within(dialog).getByRole("button", { name: "重试该工具" }),
    );
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].targetApp).toBe("codex");
    expect(account!.applyApps).toEqual(initial.applyApps);
    expect(await within(dialog).findByText("已应用")).toBeInTheDocument();
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
  it("saves target switches without applying a model", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "应用目标" }));
    await user.click(screen.getByRole("switch", { name: /Gemini CLI/ }));
    await waitFor(() => expect(account!.applyApps.gemini).toBe(true));
    expect(calls).toHaveLength(0);
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
      expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "刷新" }));
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
