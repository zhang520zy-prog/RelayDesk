import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import { server } from "../msw/server";
import {
  formatRelayMoney,
  formatRelayQuota,
  inferRelayTargets,
  relayApi,
} from "@/lib/api/relay";

describe("relay model ingress", () => {
  it("uses opaque saved-login ids and never sends a password for session restore", async () => {
    let restorePayload: unknown;
    let forgetPayload: unknown;
    server.use(
      http.post("http://tauri.local/relay_list_saved_logins", () =>
        HttpResponse.json([
          {
            id: "saved-a",
            baseUrl: "https://relay.example.test",
            username: "demo",
            updatedAt: 1,
          },
        ]),
      ),
      http.post("http://tauri.local/relay_login_saved", async ({ request }) => {
        restorePayload = await request.json();
        return HttpResponse.json(null);
      }),
      http.post(
        "http://tauri.local/relay_forget_login",
        async ({ request }) => {
          forgetPayload = await request.json();
          return HttpResponse.json(null);
        },
      ),
    );
    expect(await relayApi.listSavedLogins()).toEqual([
      {
        id: "saved-a",
        baseUrl: "https://relay.example.test",
        username: "demo",
        updatedAt: 1,
      },
    ]);
    await relayApi.loginSaved("saved-a");
    await relayApi.forgetLogin("saved-a");
    expect(restorePayload).toEqual({ savedId: "saved-a" });
    expect(forgetPayload).toEqual({ savedId: "saved-a" });
  });

  it("passes the remembered sign-in choice through the Rust adapter", async () => {
    let payload: unknown;
    server.use(
      http.post("http://tauri.local/relay_login", async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({
          baseUrl: "https://relay.example.test",
          username: "demo",
          quota: 1,
          usedQuota: 0,
          group: "standard",
          applyApps: { claude: true, codex: true, gemini: true, grok: false },
          groupTargets: {},
          updatedAt: 1,
        });
      }),
    );
    await relayApi.login("https://relay.example.test", "demo", "secret", true);
    expect(payload).toEqual({
      baseUrl: "https://relay.example.test",
      username: "demo",
      password: "secret",
      remember: true,
    });
  });

  it("formats quota with the server-provided currency configuration", () => {
    const account = {
      currencySymbol: "¥",
      currencyCode: "CNY",
      quotaPerUnit: 500_000,
      displayInCurrency: true,
    };
    expect(formatRelayQuota(5_000_000, account)).toBe("¥10.00");
    expect(
      formatRelayQuota(5_000_000, { ...account, currencySymbol: "$" }),
    ).toBe("$10.00");
    expect(
      formatRelayQuota(5_000_000, { ...account, displayInCurrency: false }),
    ).toBe("5,000,000 quota");
  });

  it("applies the display rate and preserves unknown raw units", () => {
    const config = {
      quotaPerUnit: 500000,
      quotaDisplayType: "CUSTOM",
      currencySymbol: "¥",
      customCurrencyExchangeRate: 7,
    };
    expect(formatRelayQuota(500000, config)).toBe("¥7.00");
    expect(
      formatRelayQuota(150, { ...config, customCurrencyExchangeRate: 1 }),
    ).toBe("¥0.0003");
    expect(formatRelayQuota(500000, { quotaPerUnit: 500000 })).toBe(
      "500,000 quota",
    );
    expect(
      formatRelayQuota(500000, { ...config, quotaDisplayType: "TOKENS" }),
    ).toBe("500,000 quota");
  });

  it("uses the server symbol for money and keeps currency codes as suffixes", () => {
    expect(
      formatRelayMoney("10.50", {
        currencyCode: "CNY",
        currencySymbol: "¥",
      }),
    ).toBe("¥10.50");
    expect(formatRelayMoney(10.5, { currencyCode: "CNY" })).toBe("10.5 CNY");
  });

  it("normalizes omitted tags without inventing pricing or descriptions", async () => {
    server.use(
      http.post("http://tauri.local/relay_list_models", () =>
        HttpResponse.json([{ group: "standard", models: [{ id: "model-a" }] }]),
      ),
    );
    expect(await relayApi.listModels()).toEqual([
      { group: "standard", models: [{ id: "model-a", tags: [] }] },
    ]);
  });
  it("keeps the two-argument apply payload compatible", async () => {
    let payload: unknown;
    server.use(
      http.post("http://tauri.local/relay_apply_model", async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json([{ app: "claude", ok: true }]);
      }),
    );
    await relayApi.applyModel("standard", "model-a");
    expect(payload).toEqual({ group: "standard", model: "model-a" });
  });

  it("keeps wallet and usage calls behind the Rust relay adapter", async () => {
    const calls: Record<string, unknown>[] = [];
    server.use(
      http.post("http://tauri.local/relay_get_topup_info", () =>
        HttpResponse.json({ enabled: false }),
      ),
      http.post(
        "http://tauri.local/relay_calculate_topup_amount",
        async ({ request }) => {
          calls.push({ command: "quote", body: await request.json() });
          return HttpResponse.json({ amount: 10, creditAmount: 10 });
        },
      ),
      http.post(
        "http://tauri.local/relay_create_topup_payment",
        async ({ request }) => {
          calls.push({ command: "pay", body: await request.json() });
          return HttpResponse.json({ status: "created" });
        },
      ),
      http.post("http://tauri.local/relay_list_topup_history", () =>
        HttpResponse.json({ items: [], isComplete: true }),
      ),
      http.post(
        "http://tauri.local/relay_get_usage_models",
        async ({ request }) => {
          calls.push({ command: "models", body: await request.json() });
          return HttpResponse.json({ items: [], isComplete: true });
        },
      ),
      http.post("http://tauri.local/relay_get_usage_summary", () =>
        HttpResponse.json({ start: "a", end: "b", isComplete: true }),
      ),
    );
    await relayApi.getTopupInfo();
    await relayApi.calculateTopupAmount("epay", 10);
    await relayApi.createTopupPayment("epay", 10, "request-1");
    await relayApi.getUsageModels({ start: "a", end: "b" });
    expect(calls).toEqual([
      { command: "quote", body: { method: "epay", amount: 10 } },
      {
        command: "pay",
        body: { method: "epay", amount: 10, clientRequestId: "request-1" },
      },
      {
        command: "models",
        body: { query: { start: "a", end: "b" } },
      },
    ]);
  });
});

describe("inferRelayTargets", () => {
  it("suggests claude and gemini groups from their names", () => {
    expect(inferRelayTargets("claude")).toEqual(["claude"]);
    expect(inferRelayTargets("Claude-Cursor")).toEqual(["claude"]);
    expect(inferRelayTargets("Gemini_Pro")).toEqual(["gemini"]);
  });
  it("suggests codex only for OpenAI-family names", () => {
    expect(inferRelayTargets("gpt")).toEqual(["codex"]);
    expect(inferRelayTargets("default", "gpt-4o")).toEqual(["codex"]);
    expect(inferRelayTargets("default", "o4-mini")).toEqual(["codex"]);
  });
  it("returns empty for unrecognized groups so callers apply to all enabled", () => {
    // 特惠/杂项组没有可识别家族——不再假装猜中某个客户端
    expect(inferRelayTargets("0元购")).toEqual([]);
    expect(inferRelayTargets("default", "deepseek-v3")).toEqual([]);
    expect(inferRelayTargets("限时特惠 devin-swe-2", "swe-2")).toEqual([]);
  });
  it("routes grok groups/models to the Grok Build target", () => {
    // Grok 已是独立 apply 目标——grok 组/模型应精确路由到它
    expect(inferRelayTargets("grok")).toEqual(["grok"]);
    expect(inferRelayTargets("Grok Heavy")).toEqual(["grok"]);
    expect(inferRelayTargets("default", "grok-4-fast")).toEqual(["grok"]);
  });
  it("routes by model name first, so claude models never hit ChatGPT", () => {
    // 回归：组名 "opus" 不含 claude，但模型名 claude-opus-5.5 必须去 claude
    expect(inferRelayTargets("opus", "claude-opus-5.5")).toEqual(["claude"]);
    expect(inferRelayTargets("default", "claude-sonnet-5")).toEqual(["claude"]);
    expect(inferRelayTargets("mixed", "gemini-2.5-pro")).toEqual(["gemini"]);
    expect(inferRelayTargets("default", "gpt-4o")).toEqual(["codex"]);
  });
});
