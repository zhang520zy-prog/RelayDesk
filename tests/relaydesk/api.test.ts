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
          applyApps: { claude: true, codex: true, gemini: true },
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
    await relayApi.listTopupHistory();
    await relayApi.getUsageModels({ start: "a", end: "b" });
    await relayApi.getUsageSummary({ start: "a", end: "b" });
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
  it("suggests codex for OpenAI-compatible and unknown groups", () => {
    expect(inferRelayTargets("0元购")).toEqual(["codex"]);
    expect(inferRelayTargets("grok")).toEqual(["codex"]);
    expect(inferRelayTargets("default")).toEqual(["codex"]);
    expect(inferRelayTargets("deepseek")).toEqual(["codex"]);
  });
  it("never routes from a model name inside an ambiguous group", () => {
    expect(inferRelayTargets("0元购")).toEqual(["codex"]);
  });
});
