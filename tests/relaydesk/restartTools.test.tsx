import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import { installRelayTranslations } from "@/relaydesk/i18n";
import { RestartToolsAction } from "@/relaydesk/models/RestartToolsAction";
import type { ApplyReport } from "@/relaydesk/state/useRelayApply";
import {
  relayApi,
  type RelayRestartCapability,
  type RelayRestartResult,
} from "@/lib/api/relay";
import { settingsApi } from "@/lib/api/settings";
import zh from "@/relaydesk/locales/zh.json";
import en from "@/relaydesk/locales/en.json";
import { emitTauriEvent } from "../msw/tauriMocks";

const claudeSuccess: ApplyReport = {
  group: "claude",
  model: "claude-looking-name",
  phase: "success",
  targets: ["claude"],
  results: [{ app: "claude", ok: true }],
  launchTargets: ["claude"],
  operationId: "first",
};

const codexSuccess: ApplyReport = {
  group: "standard",
  model: "sample-model",
  phase: "success",
  targets: ["codex"],
  results: [{ app: "codex", ok: true }],
  launchTargets: ["codex"],
  operationId: "op-restart",
};

const capClaudeCli: RelayRestartCapability = {
  app: "claude",
  supported: false,
  installed: true,
  running: null,
  targetKind: "cli",
  readsCliConfig: true,
  reason: "cli_session_unsafe",
};

const capClaudeDesktop: RelayRestartCapability = {
  app: "claude",
  supported: true,
  installed: true,
  running: true,
  targetKind: "desktop",
  targetId: "claude:desktop:claude",
  displayName: "Claude desktop",
  readsCliConfig: true,
};

const capCodexRunning: RelayRestartCapability = {
  app: "codex",
  supported: true,
  installed: true,
  running: true,
  targetKind: "desktop",
  targetId: "codex:desktop:chatgpt",
  displayName: "ChatGPT (Codex)",
  readsCliConfig: true,
};

const capCodexStopped: RelayRestartCapability = {
  ...capCodexRunning,
  running: false,
};

const capGemini: RelayRestartCapability = {
  app: "gemini",
  supported: false,
  installed: true,
  running: null,
  targetKind: "cli",
  readsCliConfig: true,
  reason: "cli_session_unsafe",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function mockCapabilities(caps: RelayRestartCapability[]) {
  vi.mocked(relayApi.getRestartCapabilities).mockResolvedValue(caps);
}

function restartResult(
  status: RelayRestartResult["status"],
  extra: Partial<RelayRestartResult> = {},
): RelayRestartResult {
  return {
    app: "codex",
    targetId: "codex:desktop:chatgpt",
    status,
    exitedExistingProcess: false,
    startedNewProcess: false,
    ...extra,
  };
}

beforeEach(async () => {
  installRelayTranslations();
  await i18n.changeLanguage("zh");
  vi.spyOn(relayApi, "launchTarget").mockResolvedValue();
  vi.spyOn(relayApi, "getRestartCapabilities").mockResolvedValue([
    capClaudeCli,
    capCodexStopped,
    capGemini,
  ]);
  vi.spyOn(relayApi, "restartTarget").mockResolvedValue(
    restartResult("restarted", {
      exitedExistingProcess: true,
      startedNewProcess: true,
    }),
  );
  vi.spyOn(settingsApi, "restart").mockResolvedValue(true);
  vi.spyOn(settingsApi, "runToolLifecycleAction").mockResolvedValue();
});

describe("restart entry button states", () => {
  it("surfaces verified Codex and Claude desktop targets beside the main restart entry", async () => {
    mockCapabilities([capClaudeDesktop, capCodexRunning, capGemini]);
    const report: ApplyReport = {
      ...codexSuccess,
      targets: ["claude", "codex"],
      launchTargets: ["claude", "codex"],
      results: [
        { app: "claude", ok: true },
        { app: "codex", ok: true },
      ],
    };
    render(
      <RestartToolsAction
        report={report}
        pending={false}
        openDeployment={() => {}}
      />,
    );

    const summary = await screen.findByRole("status", {
      name: "可重启桌面目标",
    });
    expect(summary).toHaveTextContent("Claude desktop");
    expect(summary).toHaveTextContent("ChatGPT (Codex)");
    expect(within(summary).queryByRole("button")).not.toBeInTheDocument();
  });

  it("stays disabled without a successful apply and explains why", () => {
    render(
      <RestartToolsAction
        report={null}
        pending={false}
        openDeployment={() => {}}
      />,
    );
    const entry = screen.getByRole("button", { name: "重启工具" });
    expect(entry).toBeDisabled();
    expect(entry).toHaveAttribute("title", "请先成功应用模型或 API 配置");
  });

  it("stays disabled while applying and while capabilities are loading", async () => {
    mockCapabilities([capClaudeCli, capCodexRunning, capGemini]);
    vi.mocked(relayApi.getRestartCapabilities).mockReturnValue(
      new Promise(() => {}),
    );
    const { rerender } = render(
      <RestartToolsAction
        report={codexSuccess}
        pending
        openDeployment={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "正在应用配置…" }),
    ).toBeDisabled();
    rerender(
      <RestartToolsAction
        report={codexSuccess}
        pending={false}
        openDeployment={() => {}}
      />,
    );
    expect(
      await screen.findByRole("button", { name: "正在检测…" }),
    ).toBeDisabled();
  });

  it("disables the entry when capability IPC fails instead of pretending", async () => {
    vi.mocked(relayApi.getRestartCapabilities).mockRejectedValue(
      new Error("ipc down"),
    );
    render(
      <RestartToolsAction
        report={codexSuccess}
        pending={false}
        openDeployment={() => {}}
      />,
    );
    const entry = await screen.findByRole("button", { name: /重启工具/ });
    expect(entry).toBeDisabled();
    expect(entry).toHaveAttribute("title", "重启能力检测失败");
  });

  it("stays disabled when the only succeeded target supports manual restart only", async () => {
    render(
      <RestartToolsAction
        report={claudeSuccess}
        pending={false}
        openDeployment={() => {}}
      />,
    );
    const entry = await screen.findByRole("button", { name: "重启工具" });
    expect(entry).toBeDisabled();
    expect(entry).toHaveAttribute(
      "title",
      "本次目标仅支持手动重启，请查看使用说明",
    );
  });
});

describe("restart execute dialog", () => {
  async function openExecute() {
    const user = userEvent.setup();
    render(
      <RestartToolsAction
        report={codexSuccess}
        pending={false}
        openDeployment={() => {}}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "重启工具" }));
    return { user, dialog: screen.getByRole("dialog") };
  }

  it("enables restart for a supported Codex target and shows the exact detected app name", async () => {
    mockCapabilities([capClaudeCli, capCodexRunning, capGemini]);
    const { dialog } = await openExecute();
    const restart = await within(dialog).findByRole("button", {
      name: "重启 ChatGPT (Codex)",
    });
    expect(restart).toBeEnabled();
    expect(
      within(dialog).getByText(/ChatGPT \(Codex\) 支持一键重启/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/当前正在运行/)).toBeInTheDocument();
  });

  it("requires a second confirmation and cancel never calls the backend", async () => {
    mockCapabilities([capClaudeCli, capCodexRunning, capGemini]);
    const { user, dialog } = await openExecute();
    await user.click(
      await within(dialog).findByRole("button", {
        name: "重启 ChatGPT (Codex)",
      }),
    );
    expect(
      within(dialog).getByText("确认重启 ChatGPT (Codex)？"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/正在进行的任务或未保存内容可能被中断/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(relayApi.restartTarget).not.toHaveBeenCalled();
    // 取消回到目标列表，重启入口仍在。
    expect(
      within(dialog).getByRole("button", { name: "重启 ChatGPT (Codex)" }),
    ).toBeInTheDocument();
  });

  it("drives the real progress stages and reports an actual restart", async () => {
    mockCapabilities([capClaudeCli, capCodexRunning, capGemini]);
    const pendingRestart = deferred<RelayRestartResult>();
    vi.mocked(relayApi.restartTarget).mockReturnValue(pendingRestart.promise);
    const { user, dialog } = await openExecute();
    await user.click(
      await within(dialog).findByRole("button", {
        name: "重启 ChatGPT (Codex)",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "确认重启" }));
    expect(within(dialog).getByText("检测目标实例")).toBeInTheDocument();
    expect(relayApi.restartTarget).toHaveBeenCalledWith(
      "codex",
      "codex:desktop:chatgpt",
      "op-restart",
    );

    act(() =>
      emitTauriEvent("relay-restart-progress", {
        operationId: "op-restart",
        app: "codex",
        stage: "requesting_exit",
      }),
    );
    expect(await within(dialog).findByText("请求正常退出")).toHaveAttribute(
      "aria-current",
      "step",
    );

    act(() =>
      emitTauriEvent("relay-restart-progress", {
        operationId: "op-restart",
        app: "codex",
        stage: "waiting_for_exit",
      }),
    );
    expect(await within(dialog).findByText("等待旧进程退出")).toHaveAttribute(
      "aria-current",
      "step",
    );

    act(() =>
      emitTauriEvent("relay-restart-progress", {
        operationId: "op-restart",
        app: "codex",
        stage: "starting",
      }),
    );
    expect(await within(dialog).findByText("重新启动")).toHaveAttribute(
      "aria-current",
      "step",
    );

    await act(async () =>
      pendingRestart.resolve(
        restartResult("restarted", {
          exitedExistingProcess: true,
          startedNewProcess: true,
        }),
      ),
    );
    expect(
      await within(dialog).findByText("已退出并重新启动 ChatGPT (Codex)。"),
    ).toBeInTheDocument();
  });

  it("ignores progress events from a stale operationId or other app", async () => {
    mockCapabilities([capClaudeCli, capCodexRunning, capGemini]);
    const pendingRestart = deferred<RelayRestartResult>();
    vi.mocked(relayApi.restartTarget).mockReturnValue(pendingRestart.promise);
    const { user, dialog } = await openExecute();
    await user.click(
      await within(dialog).findByRole("button", {
        name: "重启 ChatGPT (Codex)",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "确认重启" }));
    act(() =>
      emitTauriEvent("relay-restart-progress", {
        operationId: "older-op",
        app: "codex",
        stage: "starting",
      }),
    );
    act(() =>
      emitTauriEvent("relay-restart-progress", {
        operationId: "op-restart",
        app: "claude",
        stage: "starting",
      }),
    );
    expect(within(dialog).getByText("检测目标实例")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await act(async () =>
      pendingRestart.resolve(
        restartResult("not_running_started", { startedNewProcess: true }),
      ),
    );
    expect(
      await within(dialog).findByText("ChatGPT (Codex) 原来未运行，已启动。"),
    ).toBeInTheDocument();
  });

  it("does not claim a restart when the tool was not running", async () => {
    vi.mocked(relayApi.restartTarget).mockResolvedValue(
      restartResult("not_running_started", { startedNewProcess: true }),
    );
    const { user, dialog } = await openExecute();
    await user.click(
      await within(dialog).findByRole("button", {
        name: "启动 ChatGPT (Codex)",
      }),
    );
    expect(
      within(dialog).getByText("启动 ChatGPT (Codex)？"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/当前未检测到 ChatGPT \(Codex\) 正在运行/),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "启动 ChatGPT (Codex)" }),
    );
    expect(
      await within(dialog).findByText("ChatGPT (Codex) 原来未运行，已启动。"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/重启完成/)).not.toBeInTheDocument();
  });

  it("refreshes target running state after starting a stopped tool", async () => {
    const calls = vi.mocked(relayApi.getRestartCapabilities);
    calls
      .mockResolvedValueOnce([capCodexStopped]) // 主入口资格检查
      .mockResolvedValueOnce([capCodexStopped]) // 对话框初始列表
      .mockResolvedValueOnce([capCodexRunning]); // 启动完成后重新进入列表
    vi.mocked(relayApi.restartTarget).mockResolvedValue(
      restartResult("not_running_started", { startedNewProcess: true }),
    );
    const { user, dialog } = await openExecute();
    await user.click(
      await within(dialog).findByRole("button", {
        name: "启动 ChatGPT (Codex)",
      }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "启动 ChatGPT (Codex)" }),
    );
    expect(
      await within(dialog).findByText("ChatGPT (Codex) 原来未运行，已启动。"),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "返回目标列表" }),
    );
    expect(
      await within(dialog).findByRole("button", {
        name: "重启 ChatGPT (Codex)",
      }),
    ).toBeEnabled();
    expect(calls).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      status: "exit_timeout" as const,
      text: /等待 ChatGPT \(Codex\) 退出超时/,
    },
    { status: "launch_failed" as const, text: /启动 ChatGPT \(Codex\) 失败/ },
    { status: "exit_refused" as const, text: /拒绝了正常退出请求/ },
  ])(
    "reports $status honestly without changing the apply success",
    async ({ status, text }) => {
      mockCapabilities([capClaudeCli, capCodexRunning, capGemini]);
      vi.mocked(relayApi.restartTarget).mockResolvedValue(
        restartResult(status),
      );
      const { user, dialog } = await openExecute();
      await user.click(
        await within(dialog).findByRole("button", {
          name: "重启 ChatGPT (Codex)",
        }),
      );
      await user.click(
        within(dialog).getByRole("button", { name: "确认重启" }),
      );
      const alert = await within(dialog).findByRole("alert");
      expect(alert).toHaveTextContent(text);
      expect(alert).toHaveTextContent("重启失败不影响本次已应用成功的配置");
      await user.click(
        within(dialog).getByRole("button", { name: "返回目标列表" }),
      );
      expect(
        within(dialog).getByRole("button", { name: "重启 ChatGPT (Codex)" }),
      ).toBeInTheDocument();
    },
  );

  it("maps an expired restart ticket to a user-facing message", async () => {
    mockCapabilities([capClaudeCli, capCodexRunning, capGemini]);
    vi.mocked(relayApi.restartTarget).mockRejectedValue(
      "relay.restart_expired",
    );
    const { user, dialog } = await openExecute();
    await user.click(
      await within(dialog).findByRole("button", {
        name: "重启 ChatGPT (Codex)",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "确认重启" }));
    expect(
      await within(dialog).findByText(/本次重启资格已失效/),
    ).toBeInTheDocument();
  });

  it("enables restart for a supported Claude desktop target", async () => {
    mockCapabilities([capClaudeDesktop, capCodexStopped, capGemini]);
    const user = userEvent.setup();
    render(
      <RestartToolsAction
        report={claudeSuccess}
        pending={false}
        openDeployment={() => {}}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "重启工具" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      await within(dialog).findByRole("button", {
        name: "重启 Claude desktop",
      }),
    );
    expect(
      within(dialog).getByText(/自动重启只作用于 Claude\.app/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认重启" }));
    expect(relayApi.restartTarget).toHaveBeenCalledWith(
      "claude",
      "claude:desktop:claude",
      "first",
    );
  });

  it("lists multiple succeeded targets with independent capabilities", async () => {
    mockCapabilities([capClaudeDesktop, capCodexRunning, capGemini]);
    const report: ApplyReport = {
      ...codexSuccess,
      targets: ["claude", "codex"],
      launchTargets: ["claude", "codex"],
      results: [
        { app: "claude", ok: true },
        { app: "codex", ok: true },
      ],
    };
    const user = userEvent.setup();
    render(
      <RestartToolsAction
        report={report}
        pending={false}
        openDeployment={() => {}}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "重启工具" }));
    const dialog = screen.getByRole("dialog");
    expect(
      await within(dialog).findByRole("button", {
        name: "重启 Claude desktop",
      }),
    ).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "重启 ChatGPT (Codex)" }),
    ).toBeEnabled();
    expect(
      within(dialog).getByText("本次应用成功：Claude Code · OpenAI Codex"),
    ).toBeInTheDocument();
  });
});

describe("restart help dialog", () => {
  it("is pure documentation: no execution entry, no backend calls", async () => {
    const user = userEvent.setup();
    render(
      <RestartToolsAction
        report={codexSuccess}
        pending={false}
        openDeployment={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "查看重启指引" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/只会在你确认后重启本次成功应用配置/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/自动重启只作用于 Claude\.app/),
    ).toBeInTheDocument();
    // 帮助页不出现任何执行动作
    expect(
      within(dialog).queryByRole("button", { name: /重启 .+/ }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /确认重启|启动 / }),
    ).not.toBeInTheDocument();
    expect(relayApi.restartTarget).not.toHaveBeenCalled();
    expect(relayApi.launchTarget).not.toHaveBeenCalled();
    expect(settingsApi.restart).not.toHaveBeenCalled();
    expect(settingsApi.runToolLifecycleAction).not.toHaveBeenCalled();
  });

  it("shows per-tool manual steps without side effects", async () => {
    const user = userEvent.setup();
    render(
      <RestartToolsAction
        report={null}
        pending={false}
        openDeployment={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "查看重启指引" }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    for (const name of [
      "ChatGPT / Codex",
      "Claude Code CLI",
      "Claude.app",
      "Gemini CLI",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/Gemini CLI 会话/)).toBeInTheDocument();
    expect(relayApi.restartTarget).not.toHaveBeenCalled();
  });

  it("provides a working deployment link and English instructions", async () => {
    await i18n.changeLanguage("en");
    const user = userEvent.setup();
    const openDeployment = vi.fn();
    render(
      <RestartToolsAction
        report={null}
        pending={false}
        openDeployment={openDeployment}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "View restart guide" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    for (const name of [
      "ChatGPT / Codex",
      "Claude Code CLI",
      "Claude.app",
      "Gemini CLI",
    ]) {
      expect(within(dialog).getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(
      within(dialog).getByText(/manual restart steps/i),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Go to tool deployment" }),
    );
    expect(openDeployment).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("restart help isolation and safe copy", () => {
  it("keeps the main action ready after browsing and closing help without rechecking capabilities", async () => {
    mockCapabilities([capCodexRunning]);
    const user = userEvent.setup();
    render(
      <RestartToolsAction
        report={codexSuccess}
        pending={false}
        openDeployment={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重启工具" })).toBeEnabled(),
    );
    const checks = vi.mocked(relayApi.getRestartCapabilities).mock.calls.length;
    await user.click(screen.getByRole("button", { name: "查看重启指引" }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /确认重启|启动 / }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("检测目标实例")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("button", { name: "重启工具" })).toBeEnabled();
    expect(relayApi.getRestartCapabilities).toHaveBeenCalledTimes(checks);
    expect(relayApi.restartTarget).not.toHaveBeenCalled();
    expect(relayApi.launchTarget).not.toHaveBeenCalled();
    expect(settingsApi.restart).not.toHaveBeenCalled();
    expect(settingsApi.runToolLifecycleAction).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "help is available without successful apply, pending=%s",
    async (pending) => {
      const user = userEvent.setup();
      render(
        <RestartToolsAction
          report={null}
          pending={pending}
          openDeployment={() => {}}
        />,
      );
      await user.click(screen.getByRole("button", { name: "查看重启指引" }));
      expect(screen.getByRole("dialog")).toBeVisible();
      expect(relayApi.getRestartCapabilities).not.toHaveBeenCalled();
      expect(relayApi.restartTarget).not.toHaveBeenCalled();
    },
  );

  it.each(["ipc", "result"])(
    "does not display raw sensitive %s error details",
    async (source) => {
      const secret =
        "PID=12345 /Users/private/Test.app com.secret.app ticket-secret sk-private osascript stderr";
      mockCapabilities([capCodexRunning]);
      if (source === "ipc")
        vi.mocked(relayApi.restartTarget).mockRejectedValue(secret);
      else
        vi.mocked(relayApi.restartTarget).mockResolvedValue(
          restartResult("launch_failed", { reason: secret }),
        );
      const user = userEvent.setup();
      render(
        <RestartToolsAction
          report={codexSuccess}
          pending={false}
          openDeployment={() => {}}
        />,
      );
      await user.click(await screen.findByRole("button", { name: "重启工具" }));
      await user.click(
        await screen.findByRole("button", { name: "重启 ChatGPT (Codex)" }),
      );
      await user.click(screen.getByRole("button", { name: "确认重启" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "重启失败不影响本次已应用成功的配置",
      );
      for (const value of secret.split(" "))
        expect(document.body.textContent).not.toContain(value);
    },
  );

  it("keeps both languages complete after guide wording changes", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });
});
