import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import { installRelayTranslations } from "@/relaydesk/i18n";
import { WalletPage } from "@/relaydesk/account/WalletPage";
import { UsagePage } from "@/relaydesk/account/UsagePage";
import { ThemeProvider } from "@/components/theme-provider";
import { LoginPage } from "@/relaydesk/auth/LoginPage";
import { Sidebar } from "@/relaydesk/layout/Sidebar";
import { relayApi, type RelayAccountInfo } from "@/lib/api/relay";

const account: RelayAccountInfo = {
  baseUrl: "https://relay.example.test",
  username: "demo",
  quota: 5_000_000,
  usedQuota: 500_000,
  group: "standard",
  applyApps: { claude: true, codex: true, gemini: false },
  groupTargets: {},
  currencyCode: "CNY",
  currencySymbol: "¥",
  quotaPerUnit: 500_000,
  displayInCurrency: true,
  updatedAt: 1,
};

function wrap(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  vi.spyOn(relayApi, "savedLoginName").mockResolvedValue(null);
  installRelayTranslations();
  await i18n.changeLanguage("zh");
  vi.spyOn(relayApi, "getTopupInfo").mockRejectedValue(
    new Error("relay.topup_not_ready"),
  );
  vi.spyOn(relayApi, "listTopupHistory").mockRejectedValue(
    new Error("relay.topup_not_ready"),
  );
  vi.spyOn(relayApi, "calculateTopupAmount").mockRejectedValue(
    new Error("relay.topup_quote_not_ready"),
  );
  vi.spyOn(relayApi, "getUsageModels").mockRejectedValue(
    new Error("relay.usage_models_not_ready"),
  );
  vi.spyOn(relayApi, "getUsageSummary").mockResolvedValue({
    start: "2026-09-13T00:00:00Z",
    end: "2026-09-20T00:00:00Z",
    timezone: "Asia/Shanghai",
    asOf: "2026-09-20T10:00:00Z",
    isComplete: false,
    unavailableFields: ["cache_read_tokens"],
  });
});

describe("wallet and usage UI", () => {
  it("notifies the session owner once when wallet data reports an expired session", async () => {
    vi.mocked(relayApi.getTopupInfo).mockRejectedValue(
      new Error("relay.session_expired private-wallet-detail"),
    );
    const onSessionExpired = vi.fn();
    wrap(<WalletPage account={account} onSessionExpired={onSessionExpired} />);
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
    expect(onSessionExpired).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("relay.session_expired"),
      }),
    );
    expect(screen.queryByText("private-wallet-detail")).not.toBeInTheDocument();
  });

  it("notifies the session owner once when usage data reports an expired session", async () => {
    vi.mocked(relayApi.getUsageModels).mockRejectedValue(
      new Error("relay.session_expired private-usage-detail"),
    );
    const onSessionExpired = vi.fn();
    wrap(<UsagePage account={account} onSessionExpired={onSessionExpired} />);
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
    expect(onSessionExpired).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("relay.session_expired"),
      }),
    );
    expect(screen.queryByText("private-usage-detail")).not.toBeInTheDocument();
  });

  it("does not notify the session owner for an ordinary wallet network error", async () => {
    vi.mocked(relayApi.getTopupInfo).mockRejectedValue(
      new Error("relay.network private-wallet-detail"),
    );
    const onSessionExpired = vi.fn();
    wrap(<WalletPage account={account} onSessionExpired={onSessionExpired} />);
    await screen.findByText("充值信息加载失败");
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(screen.queryByText("private-wallet-detail")).not.toBeInTheDocument();
  });

  it("refreshes balance and shows the matching credited order without creating another payment", async () => {
    vi.mocked(relayApi.getTopupInfo).mockResolvedValue({
      enabled: true,
      amountOptions: [10],
      payMethods: [{ id: "alipay", enabled: true }],
    });
    vi.mocked(relayApi.calculateTopupAmount).mockResolvedValue({
      amount: 10,
      payAmount: 10,
    });
    vi.mocked(relayApi.listTopupHistory).mockResolvedValue({
      items: [],
      isComplete: true,
    });
    const create = vi
      .spyOn(relayApi, "createTopupPayment")
      .mockResolvedValue({ tradeNo: "my-order", status: "pending" });
    const refreshAccount = vi.fn().mockResolvedValue(true);
    wrap(<WalletPage account={account} refreshAccount={refreshAccount} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "去付款" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "去付款",
      }),
    );
    await screen.findByText(/订单已创建，收银台已打开/);
    vi.mocked(relayApi.listTopupHistory).mockResolvedValue({
      items: [
        { tradeNo: "other-order", status: "pending" },
        { tradeNo: "my-order", status: "credited" },
      ],
      isComplete: true,
    });
    await user.click(screen.getByRole("button", { name: "查询到账状态" }));
    expect(
      await screen.findByText("该订单已到账，余额已更新。"),
    ).toBeInTheDocument();
    expect(refreshAccount).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(/订单已创建，收银台已打开/),
    ).not.toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("does not claim an unrelated credited order belongs to the current checkout", async () => {
    vi.mocked(relayApi.getTopupInfo).mockResolvedValue({
      enabled: true,
      amountOptions: [10],
      payMethods: [{ id: "alipay", enabled: true }],
    });
    vi.mocked(relayApi.calculateTopupAmount).mockResolvedValue({
      amount: 10,
      payAmount: 10,
    });
    vi.mocked(relayApi.listTopupHistory).mockResolvedValue({
      items: [],
      isComplete: true,
    });
    vi.spyOn(relayApi, "createTopupPayment").mockResolvedValue({
      tradeNo: "pending-order",
      status: "pending",
    });
    wrap(<WalletPage account={account} refreshAccount={async () => true} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "去付款" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "去付款",
      }),
    );
    await screen.findByText(/订单已创建，收银台已打开/);
    vi.mocked(relayApi.listTopupHistory).mockResolvedValue({
      items: [{ tradeNo: "unrelated", status: "credited" }],
      isComplete: true,
    });
    await user.click(screen.getByRole("button", { name: "查询到账状态" }));
    expect(
      await screen.findByText("未能确认该订单的最新状态，请稍后重新查询。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("该订单已到账，余额已更新。"),
    ).not.toBeInTheDocument();
  });
  it("keeps a balance refresh failure explicit without exposing the raw error", async () => {
    const refreshAccount = vi
      .fn()
      .mockRejectedValue(new Error("private-session-value"));
    wrap(<WalletPage account={account} refreshAccount={refreshAccount} />);
    const user = userEvent.setup();
    await screen.findByText("充值信息加载失败");
    await user.click(screen.getByRole("button", { name: "重新读取" }));
    expect(
      await screen.findByText("余额未能更新，当前仍显示上次读取结果，请重试。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("private-session-value")).not.toBeInTheDocument();
  });

  it("sorts numeric usage and scopes totals to the filter", async () => {
    vi.mocked(relayApi.getUsageModels).mockResolvedValue({
      items: [
        { modelId: "a", displayName: "a", totalTokens: 9, requestCount: 2 },
        { modelId: "b", displayName: "b", totalTokens: 120, requestCount: 3 },
        { modelId: "c", displayName: "c", requestCount: 1 },
      ],
      isComplete: true,
    });
    const user = userEvent.setup();
    wrap(<UsagePage />);
    const table = await screen.findByRole("table");
    const names = () =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[0].textContent);
    expect(names()).toEqual(["b", "a", "c"]);
    await user.click(within(table).getByRole("button", { name: /总 Token/ }));
    expect(names()).toEqual(["a", "b", "c"]);
    expect(
      within(table).getByRole("columnheader", { name: /总 Token/ }),
    ).toHaveAttribute("aria-sort", "ascending");
    await user.selectOptions(screen.getByLabelText(/模型筛选/), "b");
    expect(names()).toEqual(["b"]);
    expect(
      within(screen.getByRole("region", { name: "当前筛选汇总" })).getByText(
        "120",
      ),
    ).toBeInTheDocument();
  });

  it("explains that top-up is unavailable when the relay contract is not ready", async () => {
    wrap(<WalletPage account={account} />);
    expect(
      await screen.findByRole("heading", { name: "充值信息加载失败" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "创建支付订单" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("充值记录加载失败")).toBeInTheDocument();
  });

  it("renders configured amount and payment choices without fabricating a paid order", async () => {
    vi.mocked(relayApi.getTopupInfo).mockResolvedValue({
      enabled: true,
      currency: "CNY",
      currencySymbol: "¥",
      amountOptions: [10, 50],
      payMethods: [
        { id: "epay", label: "官方收银台", enabled: true },
        { id: "stripe", label: "Stripe", enabled: false },
      ],
      message: "测试环境",
    });
    vi.mocked(relayApi.listTopupHistory).mockResolvedValue({
      items: [],
      total: 0,
      isComplete: true,
    });
    const user = userEvent.setup();
    wrap(<WalletPage account={account} />);
    expect(await screen.findByText("官方收银台")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "¥50" }));
    expect(screen.getByRole("button", { name: "¥50" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText(
        "保留所选金额与支付方式，确认后在浏览器打开本订单收银台。",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("暂时无法取得站点报价，请重试。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "创建支付订单" }),
    ).not.toBeInTheDocument();
  });

  it("creates checkout only after confirmation and keeps cancellation side-effect free", async () => {
    vi.mocked(relayApi.getTopupInfo).mockResolvedValue({
      enabled: true,
      amountOptions: [10],
      payMethods: [{ id: "alipay", label: "支付宝", enabled: true }],
    });
    vi.mocked(relayApi.calculateTopupAmount).mockResolvedValue({
      amount: 10,
      payAmount: 10,
    });
    const create = vi
      .spyOn(relayApi, "createTopupPayment")
      .mockResolvedValue({ tradeNo: "fixture-order", status: "pending" });
    const user = userEvent.setup();
    wrap(<WalletPage account={account} />);
    await user.click(await screen.findByRole("button", { name: "去付款" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }),
    );
    expect(create).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "去付款" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "去付款",
      }),
    );
    expect(create).toHaveBeenCalledWith("alipay", 10, expect.any(String));
    expect(
      await screen.findByText(/订单已创建，收银台已打开/),
    ).toBeInTheDocument();
    expect(screen.queryByText("已到账")).not.toBeInTheDocument();
  });

  it("keeps raw errors out of the payment dialog and blocks a blind retry", async () => {
    vi.mocked(relayApi.getTopupInfo).mockResolvedValue({
      enabled: true,
      amountOptions: [10],
      payMethods: [{ id: "wxpay", label: "微信", enabled: true }],
    });
    vi.mocked(relayApi.calculateTopupAmount).mockResolvedValue({
      amount: 10,
      payAmount: 10,
    });
    vi.spyOn(relayApi, "createTopupPayment").mockRejectedValue(
      new Error("secret-signed-checkout"),
    );
    const user = userEvent.setup();
    wrap(<WalletPage account={account} />);
    await user.click(await screen.findByRole("button", { name: "去付款" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "去付款",
      }),
    );
    expect(
      await screen.findByText(/未能完成订单创建或打开收银台/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "去付款",
      }),
    ).toBeDisabled();
    expect(
      screen.queryByText("secret-signed-checkout"),
    ).not.toBeInTheDocument();
  });

  it("keeps credited and crediting order states distinct", async () => {
    vi.mocked(relayApi.getTopupInfo).mockResolvedValue({
      enabled: false,
      message: "站点关闭在线充值",
    });
    vi.mocked(relayApi.listTopupHistory).mockResolvedValue({
      isComplete: true,
      items: [
        {
          tradeNo: "paid-1",
          status: "credited",
          payAmount: 20,
          creditAmount: 20,
          currency: "CNY",
          currencySymbol: "¥",
        },
        { tradeNo: "pending-1", status: "crediting", creditAmount: 30 },
      ],
    });
    wrap(<WalletPage account={account} />);
    expect(await screen.findByText("充值暂不可用")).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("已到账")).toBeInTheDocument();
    expect(within(table).getByText("入账处理中")).toBeInTheDocument();
    expect(within(table).getAllByText("¥20")).toHaveLength(2);
  });

  it("shows the model comparison table and preserves unknown fields", async () => {
    vi.mocked(relayApi.getUsageModels).mockResolvedValue({
      items: [
        {
          modelId: "model-a",
          displayName: "model-a",
          group: "Codex_Group",
          requestCount: 3,
          inputTokens: 100,
          outputTokens: 40,
          totalTokens: 140,
          chargedAmount: "1.20",
          currency: "CNY",
          currencySymbol: "¥",
          successRate: 1,
          source: null,
        },
        {
          modelId: "model-b",
          displayName: "model-b",
          group: "Claude_Group",
          requestCount: 1,
          inputTokens: 50,
          outputTokens: 20,
          totalTokens: 70,
          source: "claude-code",
        },
      ],
      total: 2,
      isComplete: true,
      asOf: "2026-09-20T10:00:00Z",
      timezone: "Asia/Shanghai",
      unavailableFields: ["cache_read_tokens", "charged_amount"],
    });
    wrap(<UsagePage />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("model-a")).toBeInTheDocument();
    expect(within(table).getByText("model-b")).toBeInTheDocument();
    expect(within(table).getByText("输入 Token")).toBeInTheDocument();
    expect(within(table).getByText("输出 Token")).toBeInTheDocument();
    expect(within(table).getByText("总 Token")).toBeInTheDocument();
    expect(within(table).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(table).queryByText("未归因")).not.toBeInTheDocument();
    expect(within(table).queryByText("缓存写")).not.toBeInTheDocument();
    expect(within(table).getByText("¥1.20")).toBeInTheDocument();
    expect(screen.queryByText("统计完整性待确认")).not.toBeInTheDocument();
    expect(screen.queryByText("区间总计")).not.toBeInTheDocument();
  });

  it.each([
    ["failed", "消费日志暂未完整读取"],
    ["incomplete", "消费日志暂未完整读取"],
  ] as const)(
    "explains %s detail data without hiding model totals",
    async (detailsStatus, message) => {
      vi.mocked(relayApi.getUsageModels).mockResolvedValue({
        items: [{ modelId: "m", displayName: "m", totalTokens: 12345 }],
        isComplete: false,
        detailsStatus,
      });
      wrap(<UsagePage />);
      expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
      expect(
        within(screen.getByRole("table")).getByText("12,345"),
      ).toBeInTheDocument();
    },
  );

  it("does not downgrade a missing aggregation endpoint into local billing data", async () => {
    wrap(<UsagePage />);
    expect(
      await screen.findByRole("heading", { name: "模型用量加载失败" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/不会使用本地代理统计替代中转站账单/),
    ).toBeInTheDocument();
  });
});

describe("login entry points", () => {
  it("switches and remembers appearance before login without signing in", async () => {
    const login = vi.fn();
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultTheme="dark" storageKey="relaydesk-theme">
        <LoginPage busy={false} error={null} login={login} />
      </ThemeProvider>,
    );
    await user.selectOptions(screen.getByLabelText("主题"), "light");
    expect(document.documentElement).toHaveClass("light");
    expect(localStorage.getItem("relaydesk-theme")).toBe("light");
    await user.selectOptions(screen.getByLabelText("主题"), "system");
    expect(localStorage.getItem("relaydesk-theme")).toBe("system");
    expect(login).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { level: 1, name: "登录 RelayDesk" }),
    ).toBeInTheDocument();
  });

  it("offers language selection and exposes password visibility state", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider storageKey="relaydesk-theme">
        <LoginPage busy={false} error={null} login={vi.fn()} />
      </ThemeProvider>,
    );
    const password = screen.getByLabelText("密码");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "显示密码" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "隐藏密码" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.selectOptions(screen.getByLabelText("语言"), "en");
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("remembers sign-in only when selected without storing a password in the renderer", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ThemeProvider storageKey="relaydesk-theme">
        <LoginPage busy={false} error={null} login={login} />
      </ThemeProvider>,
    );
    expect(
      screen.getByRole("link", {
        name: "https://www.shenlanqaq.com/sign-in",
      }),
    ).toHaveAttribute("href", "https://www.shenlanqaq.com/sign-in");
    expect(screen.getByRole("link", { name: "注册账号" })).toHaveAttribute(
      "href",
      "https://www.shenlanqaq.com/sign-up",
    );
    expect(screen.getByRole("link", { name: "找回密码" })).toHaveAttribute(
      "href",
      "https://www.shenlanqaq.com/forgot-password",
    );
    expect(
      screen.getByRole("checkbox", { name: /记住密码/ }),
    ).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: /记住密码/ }));
    expect(
      screen.queryByText("仅本次登录，不保存密码，不访问钥匙串。"),
    ).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("邮箱或用户名"), "demo");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.click(screen.getByRole("button", { name: /登录/ }));
    expect(login).toHaveBeenCalledWith(
      "https://www.shenlanqaq.com/",
      "demo",
      "secret",
      true,
    );
    expect(localStorage.length).toBe(1);
    expect(localStorage.key(0)).toBe("relaydesk-theme");
    expect(localStorage.getItem("relaydesk-theme")).toBe("system");
  });
});

describe("workspace navigation", () => {
  it("offers wallet and usage as separate top-level pages", async () => {
    const navigate = vi.fn();
    render(
      <Sidebar
        page="models"
        navigate={navigate}
        account={account}
        collapsed={false}
        onCollapse={() => {}}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "钱包与充值" }));
    await user.click(screen.getByRole("button", { name: "用量统计" }));
    expect(navigate).toHaveBeenNthCalledWith(1, "wallet");
    expect(navigate).toHaveBeenNthCalledWith(2, "usage");
  });
});
