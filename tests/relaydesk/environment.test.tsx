import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import { installRelayTranslations } from "@/relaydesk/i18n";
import { settingsApi } from "@/lib/api/settings";
import { relayApi } from "@/lib/api/relay";
import {
  EnvironmentPage,
  EnvironmentCheckRow,
} from "@/relaydesk/environment/EnvironmentPage";
import { InstallToolDialog } from "@/relaydesk/environment/InstallToolDialog";
import {
  canLaunchDesktop,
  getRuntimePlatform,
} from "@/relaydesk/environment/platform";

function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}
beforeEach(async () => {
  installRelayTranslations();
  await i18n.changeLanguage("en");
  vi.spyOn(relayApi, "getToolInstallPlan").mockImplementation(async (app) => ({
    app,
    source:
      app === "claude" ? "Anthropic official installer · npm fallback" : "npm",
    command:
      app === "claude"
        ? "official-installer || npm i -g @anthropic-ai/claude-code@latest"
        : app === "codex"
          ? "npm i -g @openai/codex@latest"
          : "npm i -g @google/gemini-cli@latest",
    docsUrl: "https://example.test/docs",
  }));
  vi.spyOn(relayApi, "envCheck").mockResolvedValue([
    { id: "git", status: "ok", detail: "2.45.0" },
    { id: "python", status: "warn", reason: "missing" },
    { id: "node", status: "ok", detail: "node 22.11.0 / npm 10.9.0" },
    { id: "writable", status: "ok" },
    { id: "relay", status: "error", reason: "unreachable" },
    {
      id: "proxy",
      status: "ok",
      detail: "http://127.0.0.1:7890",
      reason: "detected",
    },
  ]);
  vi.spyOn(relayApi, "detectTargetInstallations").mockResolvedValue([
    {
      app: "claude",
      cliPath: "/synthetic/claude",
      desktopApp: "/Applications/Claude.app",
      desktopName: "Claude",
      desktopReadsCliConfig: true,
      desktopCandidates: ["Claude"],
      desktopUrl: "https://claude.ai/download",
    },
    {
      app: "codex",
      desktopCandidates: ["ChatGPT (Codex)", "Codex (legacy name)"],
      desktopUrl: "https://chatgpt.com/download",
    },
    { app: "gemini" },
  ]);
  vi.spyOn(relayApi, "envFixPlan").mockImplementation(async (checkId) => ({
    id: checkId,
    supported: true,
    command: `brew install ${checkId}`,
    source: `Homebrew · ${checkId}`,
    docsUrl: "https://example.test/env",
  }));
  vi.spyOn(relayApi, "envFix").mockResolvedValue();
  vi.spyOn(settingsApi, "getToolVersions").mockResolvedValue([
    {
      name: "claude",
      version: "1.2.3",
      latest_version: null,
      error: null,
      installed_but_broken: false,
      env_type: "macos",
      wsl_distro: null,
    },
    {
      name: "codex",
      version: null,
      latest_version: null,
      error: "not found",
      installed_but_broken: false,
      env_type: "macos",
      wsl_distro: null,
    },
    {
      name: "gemini",
      version: null,
      latest_version: null,
      error: "secret raw error",
      installed_but_broken: true,
      env_type: "macos",
      wsl_distro: null,
    },
  ]);
});
afterEach(() => vi.restoreAllMocks());

describe("environment health", () => {
  it("blocks installation while another workspace operation is pending", async () => {
    mount(<EnvironmentPage onBack={() => {}} busy />);
    expect(
      await screen.findByRole("button", { name: "Install CLI" }),
    ).toBeDisabled();
  });
  it("shows only real CLI findings and real environment doctor results", async () => {
    mount(<EnvironmentPage onBack={() => {}} platform="macos" />);
    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
    const git = screen.getByText("Git").closest("li")!;
    expect(await within(git).findByText("2.45.0")).toBeInTheDocument();
    expect(within(git).getByText("Healthy")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Python not detected (optional for some workflows)",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Cannot reach the relay station; check network or proxy",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("http://127.0.0.1:7890"),
    ).toBeInTheDocument();
    // 桌面端与 CLI 分行：Claude 桌面端已装，Codex 桌面端未装但可下载
    const claudeDesktop = screen.getByText("Claude desktop").closest("li")!;
    expect(
      within(claudeDesktop).getByText("Installed; reads the CLI config"),
    ).toBeInTheDocument();
    const codexDesktop = screen
      .getByText("ChatGPT (Codex) desktop")
      .closest("li")!;
    expect(
      within(codexDesktop).getByText(
        "Not installed (optional; the CLI works without it)",
      ),
    ).toBeInTheDocument();
    expect(
      within(codexDesktop).getByRole("button", {
        name: "Download desktop app",
      }),
    ).toBeEnabled();
    // Gemini 无桌面入口（CLI 已足够）→ 不渲染桌面端行
    expect(screen.queryByText("Gemini CLI desktop")).not.toBeInTheDocument();
    expect(screen.getByText("Installed, but cannot run")).toBeInTheDocument();
    expect(screen.queryByText("secret raw error")).not.toBeInTheDocument();
    expect(
      within(screen.getByText("OpenAI Codex").closest("li")!).getByRole(
        "button",
        { name: "Install CLI" },
      ),
    ).toBeEnabled();
  });
  it("does not turn a detection failure into a missing tool", async () => {
    vi.mocked(relayApi.detectTargetInstallations).mockRejectedValue(
      new Error("unavailable"),
    );
    vi.mocked(settingsApi.getToolVersions).mockRejectedValue(
      new Error("unavailable"),
    );
    mount(<EnvironmentPage onBack={() => {}} />);
    await screen.findAllByText("Unable to confirm installation");
    expect(
      screen.queryByRole("button", { name: "Install CLI" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(relayApi.detectTargetInstallations).toHaveBeenCalledTimes(2),
    );
  });
  it("shows every check as loading while detections are pending", () => {
    vi.mocked(relayApi.detectTargetInstallations).mockReturnValue(
      new Promise(() => {}),
    );
    vi.mocked(settingsApi.getToolVersions).mockReturnValue(
      new Promise(() => {}),
    );
    vi.mocked(relayApi.envCheck).mockReturnValue(new Promise(() => {}));
    mount(<EnvironmentPage onBack={() => {}} />);
    expect(screen.getAllByText("Checking…")).toHaveLength(9);
    expect(screen.queryByText("Not installed")).not.toBeInTheDocument();
  });
  it("shows a check failure instead of invented results when env check fails", async () => {
    vi.mocked(relayApi.envCheck).mockRejectedValue(new Error("unavailable"));
    mount(<EnvironmentPage onBack={() => {}} />);
    await waitFor(() =>
      expect(screen.getAllByText("Check failed").length).toBeGreaterThanOrEqual(
        6,
      ),
    );
  });
  it("opens the registry-provided desktop download page for a missing desktop app", async () => {
    const open = vi.spyOn(relayApi, "openDesktopDownload").mockResolvedValue();
    mount(<EnvironmentPage onBack={() => {}} platform="macos" />);
    const desktop = (
      await screen.findByText("ChatGPT (Codex) desktop")
    ).closest("li")!;
    await userEvent.click(
      within(desktop).getByRole("button", { name: "Download desktop app" }),
    );
    await waitFor(() => expect(open).toHaveBeenCalledWith("codex"));
  });
  it("marks desktop detection as unsupported off macOS but still offers the download", async () => {
    mount(<EnvironmentPage onBack={() => {}} platform="windows" />);
    const desktop = (
      await screen.findByText("ChatGPT (Codex) desktop")
    ).closest("li")!;
    expect(
      within(desktop).getByText(
        "Automatic detection isn't available on this platform; download the desktop app to install it manually",
      ),
    ).toBeInTheDocument();
    expect(within(desktop).getByText("Not supported")).toBeInTheDocument();
    expect(
      within(desktop).getByRole("button", { name: "Download desktop app" }),
    ).toBeEnabled();
  });
  it.each([
    "ok",
    "warn",
    "error",
    "fixable",
    "loading",
    "unavailable",
    "unsupported",
  ] as const)("renders %s with accessible status", (status) => {
    mount(
      <EnvironmentCheckRow
        check={{
          id: "synthetic",
          label: "Synthetic",
          status,
          detail: "Fixture only",
        }}
      />,
    );
    expect(screen.getByRole("listitem")).toHaveAttribute("data-status", status);
    expect(screen.getByText("Fixture only")).toBeInTheDocument();
  });
  it("offers headless guidance and no desktop action on Linux Server", async () => {
    mount(<EnvironmentPage onBack={() => {}} platform="linux-server" />);
    await screen.findByText("1.2.3");
    expect(screen.getByText(/SSH/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open desktop app" }),
    ).not.toBeInTheDocument();
    expect(canLaunchDesktop("linux-server")).toBe(false);
    expect(getRuntimePlatform("Linux x86_64")).toBe("linux-unknown");
  });
  it("offers one-click install for a missing system dependency", async () => {
    mount(<EnvironmentPage onBack={() => {}} />);
    const python = screen.getByText("Python").closest("li")!;
    await userEvent.click(
      await within(python).findByRole("button", { name: "Install" }),
    );
    expect(await screen.findByText("brew install python")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm install" }),
    );
    await waitFor(() => expect(relayApi.envFix).toHaveBeenCalledWith("python"));
  });
  it("shows manual guidance instead of running anything when auto-install is unsupported", async () => {
    vi.mocked(relayApi.envFixPlan).mockResolvedValue({
      id: "python",
      supported: false,
      docsUrl: "https://example.test/env",
    });
    const open = vi.spyOn(settingsApi, "openExternal").mockResolvedValue();
    mount(<EnvironmentPage onBack={() => {}} />);
    const python = screen.getByText("Python").closest("li")!;
    await userEvent.click(
      await within(python).findByRole("button", { name: "Install" }),
    );
    await screen.findByText(
      "Automatic install isn't supported on this system. Open the official page to install it manually.",
    );
    expect(
      screen.queryByRole("button", { name: "Confirm install" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Official installation guide" }),
    );
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith("https://example.test/env"),
    );
    expect(relayApi.envFix).not.toHaveBeenCalled();
  });
  it("exports existing redacted diagnostics and does not export on cancel", async () => {
    const save = vi
      .spyOn(settingsApi, "saveFileDialog")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("/synthetic/diagnostics.log");
    const exportLogs = vi
      .spyOn(relayApi, "exportDiagnostics")
      .mockResolvedValue({ filePath: "/synthetic/diagnostics.log" });
    mount(<EnvironmentPage onBack={() => {}} />);
    const button = screen.getByRole("button", {
      name: "Export diagnostic logs",
    });
    await userEvent.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(exportLogs).not.toHaveBeenCalled();
    await userEvent.click(button);
    await screen.findByText("Diagnostic logs exported");
    expect(save).toHaveBeenCalledTimes(2);
    expect(exportLogs).toHaveBeenCalledWith("/synthetic/diagnostics.log");
  });
});

describe("explicit installation confirmation", () => {
  it("refreshes cached environment findings after installing from another entry", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const wrap = (node: React.ReactNode) => (
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    );
    const view = render(wrap(<EnvironmentPage onBack={() => {}} />));
    await screen.findByRole("button", { name: "Install CLI" });
    vi.spyOn(settingsApi, "runToolLifecycleAction").mockResolvedValue();
    view.rerender(
      wrap(
        <InstallToolDialog
          app="codex"
          onClose={() => {}}
          onInstalled={() => {}}
        />,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Confirm install" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Installing…" }),
      ).not.toBeInTheDocument(),
    );
    vi.mocked(settingsApi.getToolVersions).mockResolvedValue([
      {
        name: "codex",
        version: "2.0.0",
        latest_version: null,
        error: null,
        installed_but_broken: false,
        env_type: "macos",
        wsl_distro: null,
      },
    ]);
    vi.mocked(relayApi.detectTargetInstallations).mockResolvedValue([
      { app: "codex", cliPath: "/synthetic/codex" },
    ]);
    view.rerender(wrap(<EnvironmentPage onBack={() => {}} />));
    expect(await screen.findByText("2.0.0")).toBeInTheDocument();
    expect(
      within(screen.getByText("OpenAI Codex").closest("li")!).queryByRole(
        "button",
        { name: "Install CLI" },
      ),
    ).not.toBeInTheDocument();
  });
  it("shows the backend-selected Claude installer instead of an npm-only preview", async () => {
    mount(
      <InstallToolDialog
        app="claude"
        onClose={() => {}}
        onInstalled={() => {}}
      />,
    );
    expect(
      await screen.findByText(
        "official-installer || npm i -g @anthropic-ai/claude-code@latest",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Anthropic official installer · npm fallback"),
    ).toBeInTheDocument();
  });
  it("shows source, command and locations; cancellation runs nothing", async () => {
    const install = vi
      .spyOn(settingsApi, "runToolLifecycleAction")
      .mockResolvedValue();
    const close = vi.fn();
    mount(
      <InstallToolDialog app="codex" onClose={close} onInstalled={() => {}} />,
    );
    expect(
      await screen.findByText("npm i -g @openai/codex@latest"),
    ).toBeInTheDocument();
    expect(screen.getByText("Installation source")).toBeInTheDocument();
    expect(screen.getByText("Locations that may change")).toBeInTheDocument();
    expect(install).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
  });
  it("installs exactly the confirmed tool, prevents duplicates and rechecks", async () => {
    let finish!: () => void;
    const install = vi
      .spyOn(settingsApi, "runToolLifecycleAction")
      .mockReturnValue(
        new Promise<void>((r) => {
          finish = r;
        }),
      );
    const recheck = vi.fn();
    mount(
      <InstallToolDialog
        app="codex"
        onClose={() => {}}
        onInstalled={recheck}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm install" }),
    );
    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith(["codex"], "install");
    expect(screen.getByRole("button", { name: "Installing…" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    finish();
    await waitFor(() => expect(recheck).toHaveBeenCalledOnce());
  });
  it("shows safe failure guidance without leaking raw installer output", async () => {
    vi.spyOn(settingsApi, "runToolLifecycleAction").mockRejectedValue(
      new Error("sk-secret /private/user/token"),
    );
    const recheck = vi.fn();
    mount(
      <InstallToolDialog
        app="gemini"
        onClose={() => {}}
        onInstalled={recheck}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm install" }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByText(/sk-secret/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Official installation guide" }),
    ).toBeInTheDocument();
    expect(recheck).not.toHaveBeenCalled();
  });
});
