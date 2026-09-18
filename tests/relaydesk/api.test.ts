import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import { server } from "../msw/server";
import { relayApi } from "@/lib/api/relay";

describe("relay model ingress", () => {
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
});
