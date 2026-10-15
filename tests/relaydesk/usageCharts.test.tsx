import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import i18n from "i18next";
import { installRelayTranslations } from "@/relaydesk/i18n";
import { UsageCharts } from "@/relaydesk/account/UsageCharts";

// jsdom has no layout. Give the real charts a viewport; retain Recharts' actual
// series and SVG rendering so the line/legend identity assertions cover wiring.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(
        children as ReactElement<{ width: number; height: number }>,
        {
          width: 720,
          height: 280,
        },
      ),
  };
});
beforeEach(() => localStorage.clear());
it("renders only the selected chart and scopes time grain to the trend", async () => {
  installRelayTranslations();
  await i18n.changeLanguage("zh");
  render(<UsageCharts rows={[]} modelFilter="all" />);
  const user = userEvent.setup();
  expect(screen.getByRole("heading", { name: /分时趋势/ })).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: /模型用量对比/ }),
  ).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("图表形式"), "bar");
  expect(
    screen.getByRole("heading", { name: /模型用量对比/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: /分时趋势/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("时间粒度")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("图表形式"), "pie");
  expect(
    screen.getByRole("heading", { name: /模型消耗占比/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: /模型用量对比/ }),
  ).not.toBeInTheDocument();
});

it("retains chart choices after leaving the page", async () => {
  installRelayTranslations();
  await i18n.changeLanguage("en");
  const first = render(<UsageCharts rows={[]} modelFilter="all" />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Chart type"), "pie");
  first.unmount();
  render(<UsageCharts rows={[]} modelFilter="all" />);
  expect(screen.getByLabelText("Chart type")).toHaveValue("pie");
});

it("shares distinct legend colors across chart views and model filtering", async () => {
  installRelayTranslations();
  await i18n.changeLanguage("zh");
  const rows = ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra"].map(
    (modelId, index) => ({
      modelId,
      displayName: modelId,
      totalTokens: 100 + index,
    }),
  );
  const { rerender } = render(<UsageCharts rows={rows} modelFilter="all" />);
  // 明细榜的色点与图表系列同色：读取圆点内联背景色做身份断言
  const colors = () =>
    Array.from(
      document.querySelectorAll<HTMLLIElement>(".rd-chart-legend li"),
    ).map(
      (li) =>
        li.querySelector<HTMLElement>(".rd-chart-legend-dot")?.style
          .background ?? "",
    );
  const initial = colors();
  expect(new Set(initial).size).toBe(3);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("图表形式"), "bar");
  expect(colors()).toEqual(initial);
  await user.selectOptions(screen.getByLabelText("图表形式"), "pie");
  expect(colors()).toEqual(initial);
  rerender(<UsageCharts rows={rows} modelFilter="gpt-5.6-sol" />);
  expect(colors()).toEqual([initial[2]]);
});

it("matches trend markers and line patterns to the legend through ranking, filtering, and refresh", async () => {
  installRelayTranslations();
  await i18n.changeLanguage("en");
  const rows = ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra"].map(
    (modelId, index) => ({
      modelId,
      displayName: modelId,
      totalTokens: 100 + index,
      requestCount: 10 - index,
    }),
  );
  const buckets = rows.flatMap((row) =>
    [0, 1].map((hour) => ({
      modelId: row.modelId,
      timestamp: 1758326400 + hour * 3600,
      totalTokens: row.totalTokens / 2,
      requestCount: row.requestCount / 2,
      chargedQuota: 1,
    })),
  );
  const { rerender } = render(
    <UsageCharts rows={rows} buckets={buckets} modelFilter="all" />,
  );
  const identities = () =>
    new Map(
      Array.from(document.querySelectorAll(".rd-chart-legend li")).map((li) => [
        li.querySelector(".rd-chart-legend-name")!.textContent,
        {
          color:
            li.querySelector<HTMLElement>(".rd-chart-legend-dot")?.style
              .background ?? "",
        },
      ]),
    );
  const assertSeriesMatchLegend = () => {
    const legends = [...identities().values()];
    const curves = Array.from(
      document.querySelectorAll(".recharts-area-curve"),
    );
    expect(curves).toHaveLength(legends.length);
    legends.forEach((legend) => {
      const matching = curves.filter(
        (curve) => curve.getAttribute("stroke") === legend.color,
      );
      expect(matching).toHaveLength(1);
      // Recharts' separate z-index layers preserve mount order across re-ranking.
      const markers = Array.from(
        document.querySelectorAll(".rd-chart-canvas [data-marker]"),
      ).filter((marker) => marker.getAttribute("stroke") === legend.color);
      expect(markers.length).toBeGreaterThan(0);
      // 同一系列的数据点标记形状一致（身份不因重排漂移）
      const shapes = new Set(
        markers.map((marker) => marker.getAttribute("data-marker")),
      );
      expect(shapes.size).toBe(1);
    });
  };
  const initial = identities();
  expect(initial.size).toBe(3);
  assertSeriesMatchLegend();
  await userEvent
    .setup()
    .selectOptions(screen.getByLabelText("Metric"), "requestCount");
  expect(identities()).toEqual(initial);
  assertSeriesMatchLegend();
  rerender(
    <UsageCharts rows={rows} buckets={buckets} modelFilter="gpt-5.6-sol" />,
  );
  expect(identities().get("gpt-5.6-sol")).toEqual(initial.get("gpt-5.6-sol"));
  assertSeriesMatchLegend();
  rerender(
    <UsageCharts
      rows={[
        {
          modelId: "a-new-model",
          displayName: "a-new-model",
          totalTokens: 1000,
          requestCount: 100,
        },
        ...rows.slice().reverse(),
      ]}
      buckets={buckets}
      modelFilter="all"
    />,
  );
  for (const [name, identity] of initial)
    expect(identities().get(name)).toEqual(identity);
});
