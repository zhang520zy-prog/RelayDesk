import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import { installRelayTranslations } from "@/relaydesk/i18n";
import {
  relayApi,
  type RelayAccountInfo,
  type RelayTargetInstall,
} from "@/lib/api/relay";
import {
  OnboardingChecklist,
  resetOnboardingDismissal,
} from "@/relaydesk/onboarding/OnboardingChecklist";

const baseAccount = {
  username: "fixture",
  quota: 0,
  applyApps: { claude: false, codex: false, gemini: false },
} as RelayAccountInfo;

function renderChecklist({
  account = baseAccount,
  applied = false,
  openTargets = vi.fn(),
  openModels = vi.fn(),
}: {
  account?: RelayAccountInfo;
  applied?: boolean;
  openTargets?: () => void;
  openModels?: () => void;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <OnboardingChecklist
        account={account}
        applied={applied}
        openTargets={openTargets}
        openModels={openModels}
      />
    </QueryClientProvider>,
  );
  return { openTargets, openModels };
}

beforeEach(async () => {
  localStorage.clear();
  installRelayTranslations();
  await i18n.changeLanguage("zh");
  vi.spyOn(relayApi, "detectTargetInstallations").mockResolvedValue([]);
  // jsdom 无 scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
});

describe("OnboardingChecklist", () => {
  it("marks login done immediately and highlights install as current step", async () => {
    renderChecklist();
    expect(screen.getByRole("list")).toBeInTheDocument();
    // 登录步已完成且无 CTA
    const loginStep = screen.getByText("登录中转站账号").closest("li")!;
    expect(loginStep.className).toContain("is-done");
    // 安装步为当前步，出现"去部署"主 CTA
    const installStep = screen.getByText("安装 AI 工具").closest("li")!;
    expect(installStep.className).toContain("is-current");
    expect(
      within(installStep).getByRole("button", { name: "去部署" }),
    ).toBeInTheDocument();
    // 进度 1/4
    await screen.findByText("1/4");
  });

  it("advances current step to enable once a tool is detected", async () => {
    vi.mocked(relayApi.detectTargetInstallations).mockResolvedValue([
      { app: "claude", cliPath: "/usr/local/bin/claude" } as RelayTargetInstall,
    ]);
    renderChecklist();
    const installStep = screen.getByText("安装 AI 工具").closest("li")!;
    await waitFor(() => expect(installStep.className).toContain("is-done"));
    const enableStep = screen.getByText("启用应用目标").closest("li")!;
    expect(enableStep.className).toContain("is-current");
  });

  it("routes CTAs to the right destinations", async () => {
    const { openTargets, openModels } = renderChecklist();
    // 安装 CTA 在环境页内滚动到工具区，不做页面跳转
    const anchor = document.createElement("div");
    anchor.className = "rd-deployment-tools";
    document.body.append(anchor);
    await userEvent.click(screen.getByRole("button", { name: "去部署" }));
    expect(anchor.scrollIntoView).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "去启用" }));
    expect(openTargets).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "去选模型" }));
    expect(openModels).toHaveBeenCalledTimes(1);
    anchor.remove();
  });

  it("celebrates then auto-hides when every step completes", async () => {
    const account = {
      ...baseAccount,
      applyApps: { claude: true, codex: false, gemini: false },
    } as RelayAccountInfo;
    vi.mocked(relayApi.detectTargetInstallations).mockResolvedValue([
      { app: "claude", cliPath: "/usr/local/bin/claude" } as RelayTargetInstall,
    ]);
    renderChecklist({ account, applied: true });
    await screen.findByText("全部就绪！模型已生效，可以开始使用了");
    // 2.4s 后自动收起并持久化跳过标记
    await waitFor(
      () => expect(screen.queryByRole("list")).not.toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(localStorage.getItem("relaydesk.onboarding.dismissed")).toBe("1");
  });

  it("persists manual skip and can be reopened", async () => {
    renderChecklist();
    await userEvent.click(screen.getByRole("button", { name: "跳过引导" }));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    // 重新挂载仍隐藏
    renderChecklist();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    // 设置页重置后重新出现
    resetOnboardingDismissal();
    renderChecklist();
    await screen.findByRole("list");
  });
});
