import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import i18n from "i18next";
import { server } from "../msw/server";
import { installRelayTranslations } from "@/relaydesk/i18n";
import { TargetsPage } from "@/relaydesk/targets/TargetsPage";
import { useRelaySession } from "@/relaydesk/state/useRelaySession";
import type { RelayAccountInfo, RelayGroup } from "@/lib/api/relay";

const initial: RelayAccountInfo = {
  baseUrl: "https://relay.example.test",
  username: "demo",
  userId: 7,
  quota: 5000000,
  usedQuota: 5000,
  group: "standard",
  updatedAt: 1,
  applyApps: { claude: true, codex: true, gemini: false },
  groupTargets: {},
};
let account: RelayAccountInfo;
let groups: RelayGroup[];
let writes: { group: string; target: string | null }[];
let refreshes: number;
let logouts: number;
let testClient: QueryClient;
const post = (cmd: string, fn: Parameters<typeof http.post>[1]) =>
  http.post(`http://tauri.local/${cmd}`, fn);
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function wrapper({ children }: { children: ReactNode }) {
  testClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider
      client={testClient}
    >
      {children}
    </QueryClientProvider>
  );
}
function Harness() {
  const session = useRelaySession();
  if (!session.account) return <p>no account</p>;
  return (
    <TargetsPage
      apps={session.account.applyApps}
      groups={session.groupsQuery.data ?? []}
      groupTargets={session.account.groupTargets}
      groupsLoading={session.groupsQuery.isPending}
      groupsError={session.groupsQuery.isError}
      refreshGroups={() => void session.refresh()}
      busy={session.busy || !!session.groupTargetSaving}
      routingBusy={session.busy}
      report={null}
      change={(apps) => void session.setApps(apps)}
      changeGroupTarget={session.setGroupTarget}
    />
  );
}
async function mountReady() {
  render(<Harness />, { wrapper });
  const select = await screen.findByRole("combobox", {
    name: "standard · 目标工具",
  });
  await waitFor(() => expect(select).toBeEnabled());
  return select;
}
beforeEach(async () => {
  installRelayTranslations();
  await i18n.changeLanguage("zh");
  account = structuredClone(initial);
  groups = [{ name: "standard", desc: "普通分组" }, { name: "claude" }];
  writes = [];
  refreshes = 0;
  logouts = 0;
  server.use(
    post("relay_get_account", () => HttpResponse.json(account)),
    post("relay_refresh_account", () => {
      refreshes++;
      return HttpResponse.json(account);
    }),
    post("relay_list_groups", () => HttpResponse.json(groups)),
    post("relay_list_models", () => HttpResponse.json([])),
    post("get_config_dir", () => HttpResponse.json("/tmp/relaydesk-test/tool")),
    post("relay_logout", () => {
      logouts++;
      return HttpResponse.json(true);
    }),
    post("relay_set_group_target", async ({ request }) => {
      const body = (await request.json()) as {
        group: string;
        target: "claude" | "codex" | "gemini" | null;
      };
      writes.push(body);
      const groupTargets = { ...account.groupTargets };
      if (body.target) groupTargets[body.group] = body.target;
      else delete groupTargets[body.group];
      account = { ...account, groupTargets };
      return HttpResponse.json(account);
    }),
  );
});

describe("group routing", () => {
  it("lets another row queue a mapping while serializing backend writes", async () => {
    const pending = gate();
    server.use(
      post("relay_set_group_target", async ({ request }) => {
        const body = (await request.json()) as {
          group: string;
          target: "claude" | "codex";
        };
        writes.push(body);
        if (writes.length === 1) await pending.promise;
        account = {
          ...account,
          groupTargets: { ...account.groupTargets, [body.group]: body.target },
        };
        return HttpResponse.json(account);
      }),
    );
    const user = userEvent.setup();
    const first = await mountReady();
    await user.selectOptions(first, "claude");
    const second = screen.getByRole("combobox", { name: "claude · 目标工具" });
    expect(first).toBeDisabled();
    expect(second).toBeEnabled();
    await user.selectOptions(second, "codex");
    expect(second).toBeDisabled();
    expect(screen.getAllByText("正在保存")).toHaveLength(2);
    expect(writes).toHaveLength(1);
    pending.release();
    await waitFor(() => expect(first).toBeEnabled());
    await waitFor(() => expect(second).toBeEnabled());
    expect(writes).toEqual([
      { group: "standard", target: "claude" },
      { group: "claude", target: "codex" },
    ]);
    expect(account.groupTargets).toEqual({
      standard: "claude",
      claude: "codex",
    });
  });
  it("shows every server group, source badges, and full text titles", async () => {
    const name = "超长中英文分组名称-Enterprise-Custom-Group-".repeat(4);
    const desc = "超长描述 Long description ".repeat(8);
    groups.push(
      { name, desc },
      ...Array.from({ length: 11 }, (_, i) => ({ name: `server-${i}` })),
    );
    account.groupTargets.claude = "codex";
    await mountReady();
    expect(screen.getAllByRole("combobox")).toHaveLength(14);
    expect(screen.getByText(name)).toHaveAttribute("title", name);
    expect(screen.getByText(desc.trim())).toHaveAttribute("title", desc);
    expect(screen.getAllByText("自动建议")).toHaveLength(13);
    expect(screen.getByText("本地覆盖")).toBeInTheDocument();
  });

  it("saves an override and clears it when automatic suggestion is selected", async () => {
    const user = userEvent.setup();
    const select = await mountReady();
    await user.selectOptions(select, "claude");
    await waitFor(() =>
      expect(screen.getByText("本地覆盖")).toBeInTheDocument(),
    );
    expect(select).toHaveValue("claude");
    await waitFor(() => expect(select).toBeEnabled());
    await user.selectOptions(select, "auto");
    await waitFor(() =>
      expect(screen.queryByText("本地覆盖")).not.toBeInTheDocument(),
    );
    expect(select).toHaveValue("auto");
    expect(writes).toEqual([
      { group: "standard", target: "claude" },
      { group: "standard", target: null },
    ]);
    expect(account.groupTargets).toEqual({});
  });

  it("keeps rows visible with a spinner only on the saving row and retries after rollback", async () => {
    const pending = gate();
    let fail = true;
    server.use(
      post("relay_set_group_target", async ({ request }) => {
        const body = (await request.json()) as {
          group: string;
          target: string | null;
        };
        writes.push(body);
        if (fail) {
          await pending.promise;
          return new HttpResponse("private raw details", { status: 500 });
        }
        account = { ...account, groupTargets: { standard: "gemini" } };
        return HttpResponse.json(account);
      }),
    );
    const user = userEvent.setup();
    const select = await mountReady();
    await user.selectOptions(select, "gemini");
    expect(await screen.findByRole("status")).toHaveTextContent("正在保存");
    expect(select).toBeDisabled();
    expect(select).toHaveValue("gemini");
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(screen.queryByText("正在加载分组")).not.toBeInTheDocument();
    pending.release();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("已恢复原设置");
    expect(select).toHaveValue("auto");
    expect(select).toBeEnabled();
    expect(screen.queryByText("private raw details")).not.toBeInTheDocument();
    fail = false;
    await user.click(within(alert).getByRole("button", { name: "重试" }));
    await waitFor(() => expect(select).toHaveValue("gemini"));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(writes).toEqual([
      { group: "standard", target: "gemini" },
      { group: "standard", target: "gemini" },
    ]);
  });

  it("warns when the saved target is disabled and keeps it selectable", async () => {
    account.groupTargets.standard = "gemini";
    const select = await mountReady();
    expect(select).toHaveValue("gemini");
    expect(
      screen.getByText("Gemini CLI 已关闭，启用后才能应用该组模型。"),
    ).toBeInTheDocument();
    expect(
      within(select).getByRole("option", { name: "Gemini CLI · 已关闭" }),
    ).toBeEnabled();
  });

  it("uses skeleton rows before groups arrive and then explains an empty account", async () => {
    const pending = gate();
    server.use(
      post("relay_list_groups", async () => {
        await pending.promise;
        return HttpResponse.json([]);
      }),
    );
    render(<Harness />, { wrapper });
    expect(await screen.findByRole("status")).toHaveTextContent("正在加载分组");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByText("当前账号没有可配置分组"),
    ).not.toBeInTheDocument();
    pending.release();
    expect(
      await screen.findByText("当前账号没有可配置分组"),
    ).toBeInTheDocument();
  });

  it("offers a retry for group loading errors without claiming groups are empty", async () => {
    let fail = true;
    server.use(
      post("relay_list_groups", () =>
        fail
          ? new HttpResponse("relay.network", { status: 500 })
          : HttpResponse.json(groups),
      ),
    );
    const user = userEvent.setup();
    render(<Harness />, { wrapper });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("暂时无法加载分组");
    expect(
      screen.queryByText("当前账号没有可配置分组"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(within(alert).getByRole("button", { name: "重试" })).toBeEnabled(),
    );
    fail = false;
    await user.click(within(alert).getByRole("button", { name: "重试" }));
    expect(
      await screen.findByRole("combobox", { name: "standard · 目标工具" }),
    ).toBeInTheDocument();
  });
});

describe("group routing session writes", () => {
  async function readySession() {
    const hook = renderHook(useRelaySession, { wrapper });
    await waitFor(() => expect(hook.result.current.account).toEqual(account));
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    return hook;
  }
  it("drops queued mappings when the session expires", async () => {
    const pending = gate();
    let requests = 0;
    server.use(
      post("relay_set_group_target", async () => {
        requests++;
        await pending.promise;
        return HttpResponse.json(account);
      }),
    );
    const { result } = await readySession();
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.setGroupTarget("standard", "claude");
      second = result.current.setGroupTarget("claude", "codex");
    });
    await waitFor(() => expect(requests).toBe(1));
    act(() => {
      result.current.handleError("relay.session_expired");
    });
    await act(async () => {
      pending.release();
      expect(await first).toBe(false);
      expect(await second).toBe(false);
    });
    expect(requests).toBe(1);
    expect(result.current.account).toBeNull();
  });
  it("reports a row save separately from page loading and locks conflicting session writes", async () => {
    const pending = gate();
    server.use(
      post("relay_set_group_target", async () => {
        await pending.promise;
        return HttpResponse.json({
          ...account,
          groupTargets: { standard: "claude" },
        });
      }),
    );
    const { result } = await readySession();
    const refreshCount = refreshes;
    let save!: Promise<boolean>;
    act(() => {
      save = result.current.setGroupTarget("standard", "claude");
    });
    expect(result.current.groupTargetSaving).toBe("standard");
    expect(result.current.busy).toBe(false);
    await act(async () => {
      await result.current.refresh();
      await result.current.logout();
    });
    expect(refreshes).toBe(refreshCount);
    expect(logouts).toBe(0);
    await act(async () => {
      pending.release();
      expect(await save).toBe(true);
    });
    expect(result.current.account?.groupTargets.standard).toBe("claude");
    expect(result.current.groupTargetSaving).toBeNull();
  });

  it("discards a late save response after the session generation changes", async () => {
    const pending = gate();
    server.use(
      post("relay_set_group_target", async () => {
        await pending.promise;
        return HttpResponse.json({
          ...account,
          groupTargets: { standard: "gemini" },
        });
      }),
    );
    const { result } = await readySession();
    let save!: Promise<boolean>;
    act(() => {
      save = result.current.setGroupTarget("standard", "gemini");
    });
    act(() => {
      result.current.handleError("relay.session_expired");
    });
    await act(async () => {
      pending.release();
      expect(await save).toBe(false);
    });
    expect(result.current.account).toBeNull();
    expect(result.current.error).toBe("expired");
  });

  it("allows a new login after expiry and keeps its save locked when the old save finishes", async () => {
    const oldSave = gate();
    const newSave = gate();
    let writesStarted = 0;
    server.use(
      post("relay_login", () => HttpResponse.json(account)),
      post("relay_set_group_target", async () => {
        const first = ++writesStarted === 1;
        await (first ? oldSave.promise : newSave.promise);
        return HttpResponse.json({
          ...account,
          groupTargets: { standard: first ? "gemini" : "claude" },
        });
      }),
    );
    const { result } = await readySession();
    let firstSave!: Promise<boolean>;
    let secondSave!: Promise<boolean>;
    act(() => {
      firstSave = result.current.setGroupTarget("standard", "gemini");
    });
    await waitFor(() => expect(writesStarted).toBe(1));
    act(() => {
      result.current.handleError("relay.session_expired");
    });
    await act(async () => {
      await result.current.login(account.baseUrl, "demo", "synthetic-password");
    });
    expect(result.current.account?.username).toBe("demo");
    act(() => {
      secondSave = result.current.setGroupTarget("standard", "claude");
    });
    await waitFor(() => expect(writesStarted).toBe(2));
    await act(async () => {
      oldSave.release();
      expect(await firstSave).toBe(false);
    });
    expect(result.current.account?.groupTargets).toEqual({});
    expect(result.current.groupTargetSaving).toBe("standard");
    await act(async () => {
      await result.current.logout();
    });
    expect(logouts).toBe(0);
    await act(async () => {
      newSave.release();
      expect(await secondSave).toBe(true);
    });
    expect(result.current.account?.groupTargets).toEqual({
      standard: "claude",
    });
  });

  it("rejects a mapping write while the initial account refresh is pending", async () => {
    const pending = gate();
    server.use(
      post("relay_refresh_account", async () => {
        await pending.promise;
        return HttpResponse.json(account);
      }),
    );
    const { result } = renderHook(useRelaySession, { wrapper });
    await waitFor(() => expect(result.current.account?.username).toBe("demo"));
    await act(async () => {
      expect(await result.current.setGroupTarget("standard", "claude")).toBe(
        false,
      );
    });
    expect(writes).toHaveLength(0);
    pending.release();
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it.each(["login", "logout"])(
    "does not let an expired %s replace a newly authenticated session",
    async (operation) => {
      const pending = gate();
      let loginCount = 0;
      server.use(
        post("relay_login", async () => {
          if (++loginCount === 1 && operation === "login") {
            await pending.promise;
            return HttpResponse.json({ ...account, username: "stale" });
          }
          return HttpResponse.json(account);
        }),
        post("relay_logout", async () => {
          await pending.promise;
          return HttpResponse.json(true);
        }),
      );
      const { result } = await readySession();
      let oldOperation!: Promise<void>;
      act(() => {
        oldOperation =
          operation === "logout"
            ? result.current.logout()
            : result.current.login(
                account.baseUrl,
                "stale",
                "synthetic-password",
              );
      });
      if (operation === "login")
        await waitFor(() => expect(loginCount).toBe(1));
      act(() => {
        result.current.handleError("relay.session_expired");
      });
      await act(async () => {
        await result.current.login(
          account.baseUrl,
          "demo",
          "synthetic-password",
        );
      });
      expect(result.current.account?.username).toBe("demo");
      await act(async () => {
        pending.release();
        await oldOperation;
      });
      expect(result.current.account?.username).toBe("demo");
    },
  );

  it("clears wallet and usage caches when the account changes", async () => {
    const { result } = await readySession();
    server.use(
      post("relay_login", () =>
        HttpResponse.json({ ...account, username: "new-user" }),
      ),
    );
    testClient.setQueryData(["relaydesk", "topup-info"], { owner: "old" });
    testClient.setQueryData(["relaydesk", "usage-models"], { owner: "old" });
    await act(async () => {
      await result.current.login(
        account.baseUrl,
        "new-user",
        "synthetic-password",
      );
    });
    expect(
      testClient.getQueryData(["relaydesk", "topup-info"]),
    ).toBeUndefined();
    expect(
      testClient.getQueryData(["relaydesk", "usage-models"]),
    ).toBeUndefined();
  });
});
