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
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import {
  relayApi,
  type RelayAccountInfo,
  type RelayTargetInstall,
} from "@/lib/api/relay";
import { settingsApi } from "@/lib/api/settings";
import { ApplyProgressDialog } from "@/relaydesk/models/ApplyProgressDialog";
import {
  type ApplyReport,
  useRelayApply,
} from "@/relaydesk/state/useRelayApply";
import { installRelayTranslations } from "@/relaydesk/i18n";

const successful: ApplyReport = {
  group: "standard",
  model: "sample-model",
  phase: "success",
  targets: ["codex"],
  results: [{ app: "codex", ok: true }],
};
const cli = { app: "codex", cliPath: "/private/user/bin/codex" };
const desktop = { app: "codex", desktopApp: "/Applications/Codex.app" };
function mount(report = successful, pending = false) {
  const onOpenChange = vi.fn();
  const props = {
    report,
    open: true,
    onOpenChange,
    pending,
    busy: false,
    apps: { claude: true, codex: true, gemini: true },
    retry: vi.fn(),
  };
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return {
    ...render(<ApplyProgressDialog {...props} />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }),
    props,
    onOpenChange,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  installRelayTranslations();
  await i18n.changeLanguage("zh");
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
  vi.spyOn(relayApi, "getToolInstallPlan").mockImplementation(async (app) => ({
    app,
    source: "synthetic source",
    command: `install-${app}`,
    docsUrl: "https://example.test/docs",
  }));
  vi.spyOn(relayApi, "detectTargetInstallations").mockResolvedValue([cli]);
  vi.spyOn(relayApi, "launchTarget").mockResolvedValue();
  vi.spyOn(settingsApi, "runToolLifecycleAction").mockResolvedValue();
});

describe("model application launch choices", () => {
  it("shows an explicit checking state without claiming the tool is missing", async () => {
    const detection = deferred<RelayTargetInstall[]>();
    vi.mocked(relayApi.detectTargetInstallations).mockReturnValue(
      detection.promise,
    );
    mount();
    expect(await screen.findByText("正在检测安装状态…")).toBeInTheDocument();
    expect(screen.queryByText("未检测到安装")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "一键安装 CLI" }),
    ).not.toBeInTheDocument();
    await act(async () => detection.resolve([cli]));
  });

  it("allows detection failure to be retried without showing missing or raw errors", async () => {
    vi.mocked(relayApi.detectTargetInstallations)
      .mockRejectedValueOnce(
        new Error("/private/user/config access_token=secret"),
      )
      .mockResolvedValueOnce([cli]);
    mount();
    expect(await screen.findByText("无法确认安装状态")).toBeInTheDocument();
    expect(screen.queryByText("未检测到安装")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("secret");
    await userEvent.click(screen.getByRole("button", { name: "重新检测" }));
    expect(
      await screen.findByRole("button", { name: "在终端中启动" }),
    ).toBeInTheDocument();
  });

  it.each([
    {
      name: "desktop and CLI",
      installed: { ...cli, ...desktop },
      desktop: true,
      terminal: "命令行启动",
    },
    { name: "desktop only", installed: desktop, desktop: true, terminal: null },
    {
      name: "CLI only",
      installed: cli,
      desktop: false,
      terminal: "在终端中启动",
    },
  ])(
    "offers only the available actions for $name and never launches automatically",
    async (entry) => {
      vi.mocked(relayApi.detectTargetInstallations).mockResolvedValue([
        entry.installed,
      ]);
      mount();
      await waitFor(() =>
        expect(screen.queryByText("正在检测安装状态…")).not.toBeInTheDocument(),
      );
      if (entry.desktop)
        expect(
          await screen.findByRole("button", { name: "打开桌面端" }),
        ).toBeInTheDocument();
      else
        expect(
          screen.queryByRole("button", { name: "打开桌面端" }),
        ).not.toBeInTheDocument();
      if (entry.terminal)
        expect(
          await screen.findByRole("button", { name: entry.terminal }),
        ).toBeInTheDocument();
      else
        expect(
          screen.queryByRole("button", { name: /终端|命令行启动/ }),
        ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "暂不启动" }),
      ).toBeInTheDocument();
      expect(relayApi.launchTarget).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain("/private/user");
      expect(document.body.textContent).not.toContain("/Applications");
    },
  );

  it("names the detected desktop and warns when it does not share the CLI configuration", async () => {
    vi.mocked(relayApi.detectTargetInstallations).mockResolvedValue([
      {
        app: "claude",
        desktopApp: "/Applications/Claude.app",
        desktopName: "Claude desktop",
        desktopReadsCliConfig: false,
      },
    ]);
    mount({
      ...successful,
      targets: ["claude"],
      results: [{ app: "claude", ok: true }],
    });
    expect(
      await screen.findByRole("button", { name: "打开 Claude desktop" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Claude desktop 与 Claude Code CLI 是不同入口/),
    ).toBeInTheDocument();
  });

  it("offers installation, guidance and cancellation only after confirming both are absent", async () => {
    vi.mocked(relayApi.detectTargetInstallations).mockResolvedValue([
      { app: "codex" },
    ]);
    const { onOpenChange } = mount();
    expect(
      await screen.findByRole("button", { name: "一键安装 CLI" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看安装方式" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(settingsApi.runToolLifecycleAction).not.toHaveBeenCalled();
    expect(relayApi.launchTarget).not.toHaveBeenCalled();
  });

  it("does not infer a missing tool from an incomplete detection response", async () => {
    vi.mocked(relayApi.detectTargetInstallations).mockResolvedValue([]);
    mount();
    expect(await screen.findByText("无法确认安装状态")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "一键安装 CLI" }),
    ).not.toBeInTheDocument();
  });

  it("declining launch closes the result without invoking launch", async () => {
    const { onOpenChange } = mount();
    await userEvent.click(
      await screen.findByRole("button", { name: "暂不启动" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(relayApi.launchTarget).not.toHaveBeenCalled();
  });

  it("keeps the successful application after a failed launch and permits an explicit retry", async () => {
    vi.mocked(relayApi.launchTarget)
      .mockRejectedValueOnce("spawn /private/user/bin/codex token=secret")
      .mockResolvedValueOnce();
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: "在终端中启动" }),
    );
    expect(
      await screen.findByText(/启动未完成，模型仍已成功应用/),
    ).toBeInTheDocument();
    expect(screen.getByText("已应用")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("secret");
    await userEvent.click(screen.getByRole("button", { name: "在终端中启动" }));
    expect(await screen.findByText("已发送启动请求")).toBeInTheDocument();
    expect(relayApi.launchTarget).toHaveBeenNthCalledWith(2, "codex", "cli");
  });

  it("offers launch choices only for successful targets after a partial application", async () => {
    mount({
      ...successful,
      phase: "partial",
      targets: ["codex", "claude"],
      results: [
        { app: "codex", ok: true },
        { app: "claude", ok: false },
      ],
    });
    const launch = await screen.findByRole("region", { name: "下一步" });
    expect(
      within(launch).getByRole("group", { name: "OpenAI Codex 启动选项" }),
    ).toBeInTheDocument();
    expect(within(launch).queryByText("Claude Code")).not.toBeInTheDocument();
  });

  it("never offers an unexpected successful target outside this application report", async () => {
    mount({
      ...successful,
      results: [
        { app: "codex", ok: true },
        { app: "claude", ok: true },
      ],
    });
    const launch = await screen.findByRole("region", { name: "下一步" });
    expect(within(launch).queryByText("Claude Code")).not.toBeInTheDocument();
  });

  it("limits choices to the successful tool in the latest single-tool retry", async () => {
    const account: RelayAccountInfo = {
      baseUrl: "https://relay.example.test",
      username: "demo",
      quota: 0,
      usedQuota: 0,
      group: "standard",
      groupTargets: {},
      updatedAt: 1,
      applyApps: { claude: true, codex: true, gemini: false },
    };
    vi.spyOn(relayApi, "applyModel")
      .mockResolvedValueOnce([{ app: "codex", ok: true }])
      .mockResolvedValueOnce([{ app: "claude", ok: true }]);
    const applied = vi.fn().mockResolvedValue(undefined);
    const generation = { current: 1 };
    const { result } = renderHook(() =>
      useRelayApply(account, applied, () => "genericError", generation),
    );
    await act(async () => result.current.apply("standard", "sample-model"));
    await act(async () =>
      result.current.apply("standard", "sample-model", "claude"),
    );
    expect(result.current.report?.results).toEqual([
      { app: "codex", ok: true },
      { app: "claude", ok: true },
    ]);
    vi.mocked(relayApi.detectTargetInstallations).mockResolvedValue([
      { app: "claude", cliPath: "/bin/claude" },
      cli,
    ]);
    mount(result.current.report!);
    const launch = await screen.findByRole("region", { name: "下一步" });
    expect(
      within(launch).getByRole("group", { name: "Claude Code 启动选项" }),
    ).toBeInTheDocument();
    expect(within(launch).queryByText("OpenAI Codex")).not.toBeInTheDocument();
  });

  it("requires install confirmation and cancellation never runs the installer", async () => {
    vi.mocked(relayApi.detectTargetInstallations).mockResolvedValue([
      { app: "codex" },
    ]);
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: "一键安装 CLI" }),
    );
    const confirmation = await screen.findByRole("dialog", {
      name: "安装 OpenAI Codex CLI",
    });
    expect(
      await within(confirmation).findByText("install-codex"),
    ).toBeInTheDocument();
    expect(settingsApi.runToolLifecycleAction).not.toHaveBeenCalled();
    await userEvent.click(
      within(confirmation).getByRole("button", { name: "取消" }),
    );
    expect(settingsApi.runToolLifecycleAction).not.toHaveBeenCalled();
    expect(relayApi.launchTarget).not.toHaveBeenCalled();
  });

  it("detects again after confirmed installation and waits for an explicit launch", async () => {
    vi.mocked(relayApi.detectTargetInstallations)
      .mockResolvedValueOnce([{ app: "codex" }])
      .mockResolvedValueOnce([cli]);
    const installation = deferred<void>();
    vi.mocked(settingsApi.runToolLifecycleAction).mockReturnValueOnce(
      installation.promise,
    );
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: "一键安装 CLI" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "确认安装" }),
    );
    expect(
      await screen.findByText(/正在安装 OpenAI Codex/),
    ).toBeInTheDocument();
    expect(settingsApi.runToolLifecycleAction).toHaveBeenCalledWith(
      ["codex"],
      "install",
    );
    await act(async () => installation.resolve());
    expect(
      await screen.findByRole("button", { name: "在终端中启动" }),
    ).toBeInTheDocument();
    expect(relayApi.detectTargetInstallations).toHaveBeenCalledTimes(2);
    expect(relayApi.launchTarget).not.toHaveBeenCalled();
  });

  it("keeps an installation failure separate from application success and offers a manual guide", async () => {
    vi.mocked(relayApi.detectTargetInstallations).mockResolvedValue([
      { app: "codex" },
    ]);
    vi.mocked(settingsApi.runToolLifecycleAction).mockRejectedValueOnce(
      new Error("/private/user secret-token"),
    );
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: "一键安装 CLI" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "确认安装" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/安装失败/);
    expect(
      await screen.findByRole("button", { name: "官方安装指引" }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("secret-token");
    expect(screen.getByText("已应用")).toBeInTheDocument();
  });

  it("hides desktop launching when Linux desktop capability is unknown", async () => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "Linux x86_64",
    });
    vi.mocked(relayApi.detectTargetInstallations).mockResolvedValue([
      { ...cli, ...desktop },
    ]);
    mount();
    expect(
      await screen.findByRole("button", { name: "在终端中启动" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "打开桌面端" }),
    ).not.toBeInTheDocument();
  });

  it("does not call a detected desktop app missing when the platform cannot launch it", async () => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "Linux x86_64",
    });
    vi.mocked(relayApi.detectTargetInstallations).mockResolvedValue([desktop]);
    mount();
    expect(
      await screen.findByRole("button", { name: "一键安装 CLI" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("未检测到安装")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "打开桌面端" }),
    ).not.toBeInTheDocument();
  });

  it("discards an earlier operation's late installation detection", async () => {
    const first = deferred<RelayTargetInstall[]>();
    vi.mocked(relayApi.detectTargetInstallations)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([cli]);
    const { rerender, props } = mount({ ...successful, operationId: "first" });
    expect(await screen.findByText("正在检测安装状态…")).toBeInTheDocument();
    rerender(
      <ApplyProgressDialog
        {...props}
        report={{ ...successful, operationId: "second" }}
      />,
    );
    expect(
      await screen.findByRole("button", { name: "在终端中启动" }),
    ).toBeInTheDocument();
    await act(async () => first.resolve([desktop]));
    expect(
      screen.queryByRole("button", { name: "打开桌面端" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "在终端中启动" }),
    ).toBeInTheDocument();
  });

  it("does not offer retained successes after the latest retry fails", () => {
    mount({
      ...successful,
      phase: "partial",
      targets: ["codex", "claude"],
      results: [
        { app: "codex", ok: true },
        { app: "claude", ok: false },
      ],
      launchTargets: [],
    });
    expect(
      screen.queryByRole("region", { name: "下一步" }),
    ).not.toBeInTheDocument();
    expect(relayApi.detectTargetInstallations).not.toHaveBeenCalled();
  });

  it("does not detect or offer launch choices while application is in progress", () => {
    mount({ ...successful, phase: "syncing" }, true);
    expect(
      screen.queryByRole("region", { name: "下一步" }),
    ).not.toBeInTheDocument();
    expect(relayApi.detectTargetInstallations).not.toHaveBeenCalled();
  });
});
