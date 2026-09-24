import { describe, expect, it } from "vitest";
import {
  modelChartColor,
  assignModelColors,
  assignModelPatterns,
  timelineTicks,
  aggregateChartModels,
  aggregateChartTimeline,
} from "@/relaydesk/account/UsageCharts";

describe("relay usage charts", () => {
  it("combines groups by model without converting unknown usage to zero", () => {
    expect(
      aggregateChartModels(
        [
          { modelId: "a", displayName: "a", totalTokens: 20 },
          { modelId: "a", displayName: "a", totalTokens: 30 },
          { modelId: "b", displayName: "b" },
        ],
        "totalTokens",
      ),
    ).toEqual([{ name: "a", value: 50 }]);
  });
  it("keeps actual time buckets and distinct model series", () => {
    const t = 1758326400;
    const point = (
      modelId: string,
      timestamp: number,
      totalTokens: number,
    ) => ({
      modelId,
      timestamp,
      totalTokens,
      requestCount: 1,
      chargedQuota: 2,
    });
    const rows = aggregateChartTimeline(
      [
        point("a", t, 10),
        point("a", t + 1, 20),
        point("b", t, 8),
        point("b", t + 7200, 7),
      ],
      "totalTokens",
      false,
      ["a", "b"],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].m0).toBe(30);
    expect(rows[0].m1).toBe(8);
    expect(rows[1].m0).toBeUndefined();
    expect(rows[1].m1).toBe(7);
  });
});

it("uses real bucket boundaries for readable time ticks", () => {
  const times = Array.from(
    { length: 25 },
    (_, i) => 1758326400000 + i * 3600000,
  );
  const ticks = timelineTicks(times);
  expect(ticks).toHaveLength(5);
  expect(ticks.every((t) => times.includes(t))).toBe(true);
  expect(ticks[0]).toBe(times[0]);
  expect(ticks.at(-1)).toBe(times.at(-1));
});
it("keeps model identity independent of metric ranking and filtering", () => {
  const rows = [
    {
      modelId: "astra",
      displayName: "astra",
      totalTokens: 120,
      requestCount: 1,
    },
    {
      modelId: "claude",
      displayName: "claude",
      totalTokens: 50,
      requestCount: 20,
    },
  ];
  const tokens = aggregateChartModels(rows, "totalTokens").find(
    (row) => row.name === "astra",
  )!;
  const requests = aggregateChartModels(rows, "requestCount").find(
    (row) => row.name === "astra",
  )!;
  expect(modelChartColor(tokens.name)).toBe(modelChartColor(requests.name));
  expect(modelChartColor(tokens.name)).toMatch(/^var\(--rd-chart-/);
});

it("assigns distinct colors to colliding model names and preserves assignments on reorder", () => {
  const names = ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra", "a", "i", "q"];
  const assigned = assignModelColors(names);
  expect(new Set(assigned.values()).size).toBe(names.length);
  expect(assignModelColors([...names].reverse())).toEqual(assigned);
  expect(
    assignModelColors(["new-model", ...names], assigned).get("gpt-5.6-sol"),
  ).toBe(assigned.get("gpt-5.6-sol"));
});
it("does not repeat the first palette when more than eight models are present", () => {
  const names = Array.from({ length: 24 }, (_, i) => "model-" + i);
  expect(new Set(assignModelColors(names).values()).size).toBe(24);
});

it("gives the first eight models distinct non-color identities", () => {
  const names = [
    "gpt-5.6-sol",
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "gpt-6-astra",
    "claude-opus",
    "claude-sonnet",
    "gemini-pro",
    "gemini-flash",
  ];
  const patterns = assignModelPatterns(names);
  expect(patterns.size).toBe(names.length);
  expect(
    new Set([...patterns.values()].map((pattern) => JSON.stringify(pattern)))
      .size,
  ).toBe(8);
  expect(
    new Set([...patterns.values()].map((pattern) => pattern.marker)).size,
  ).toBeGreaterThan(1);
  expect(
    new Set([...patterns.values()].map((pattern) => pattern.strokeDasharray))
      .size,
  ).toBeGreaterThan(1);
  expect(assignModelPatterns([...names].reverse())).toEqual(patterns);
});

it("preserves model markers and line patterns as refreshed models appear or disappear", () => {
  const initial = assignModelPatterns([
    "gpt-5.6-sol",
    "gpt-5.6-luna",
    "gpt-5.6-terra",
  ]);
  const refreshed = assignModelPatterns(["new-model", "gpt-5.6-luna"], initial);
  for (const [name, pattern] of initial) {
    expect(refreshed.get(name)).toEqual(pattern);
  }
  expect(refreshed.get("new-model")).toBeDefined();
  expect(
    assignModelPatterns(["gpt-5.6-terra"], refreshed).get("gpt-5.6-terra"),
  ).toEqual(initial.get("gpt-5.6-terra"));
});
