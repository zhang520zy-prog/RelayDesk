import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  formatRelayQuota,
  type RelayAccountInfo,
  type RelayUsageBucket,
  type RelayUsageModelRow,
} from "@/lib/api/relay";

import { useViewPreference } from "../state/useViewPreference";

type Metric = "totalTokens" | "requestCount" | "chargedQuota";
const colors = Array.from(
  { length: 8 },
  (_, index) => "var(--rd-chart-" + (index + 1) + ")",
);

export function modelChartColor(name: string) {
  let hash = 0;
  for (const character of name)
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return colors[(hash >>> 0) % colors.length];
}

// Allocate across the full model set, before ranking or filtering. Preserve colors
// during refreshes; resolve palette collisions instead of hashing to the same slot.
export function assignModelColors(
  names: string[],
  previous = new Map<string, string>(),
) {
  const assigned = new Map(previous);
  const used = new Set(assigned.values());
  for (const name of [...new Set(names)].sort()) {
    if (assigned.has(name)) continue;
    const preferred = modelChartColor(name);
    let color = !used.has(preferred)
      ? preferred
      : colors.find((color) => !used.has(color));
    if (!color) {
      let index = assigned.size;
      do {
        const hue = (index++ * 137.508) % 360;
        color = "hsl(" + hue.toFixed(3) + " 58% var(--rd-chart-lightness))";
      } while (used.has(color));
    }
    assigned.set(name, color);
    used.add(color);
  }
  return assigned;
}

const chartMarkers = ["circle", "square", "diamond", "triangle"] as const;
const chartLinePatterns = [undefined, "8 4", "2 4", "8 3 2 3"] as const;
type ModelChartPattern = {
  marker: (typeof chartMarkers)[number];
  strokeDasharray: (typeof chartLinePatterns)[number];
};

// Use the complete model set, just as for colors. Retain identities when a
// refresh removes/adds models, so filters or changed rankings cannot re-key them.
export function assignModelPatterns(
  names: string[],
  previous = new Map<string, ModelChartPattern>(),
) {
  const assigned = new Map(previous);
  for (const name of [...new Set(names)].sort()) {
    if (assigned.has(name)) continue;
    const index = assigned.size;
    assigned.set(name, {
      marker:
        chartMarkers[
          (index + Math.floor(index / chartMarkers.length)) %
            chartMarkers.length
        ],
      strokeDasharray: chartLinePatterns[index % chartLinePatterns.length],
    });
  }
  return assigned;
}

function ModelChartMarker({
  cx,
  cy,
  marker,
  color,
  size = 3.25,
}: {
  cx?: number;
  cy?: number;
  marker: ModelChartPattern["marker"];
  color: string;
  size?: number;
}) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return (
    <g
      className="rd-chart-marker"
      data-marker={marker}
      transform={`translate(${cx}, ${cy})`}
      fill="var(--rd-surface)"
      stroke={color}
      strokeWidth={1.5}
    >
      {marker === "circle" && <circle r={size} />}
      {marker === "square" && (
        <rect x={-size} y={-size} width={size * 2} height={size * 2} rx={0.5} />
      )}
      {marker === "diamond" && (
        <polygon
          points={`0,${-size * 1.25} ${size * 1.25},0 0,${size * 1.25} ${-size * 1.25},0`}
        />
      )}
      {marker === "triangle" && (
        <polygon
          points={`0,${-size * 1.25} ${size * 1.1},${size} ${-size * 1.1},${size}`}
        />
      )}
    </g>
  );
}

export function timelineTicks(times: number[]) {
  const stride = Math.max(1, Math.ceil((times.length - 1) / 4));
  return times.filter(
    (_, index) => index % stride === 0 || index === times.length - 1,
  );
}

export function aggregateChartModels(
  rows: RelayUsageModelRow[],
  metric: Metric,
) {
  const sums = new Map<string, number | undefined>();
  for (const row of rows) {
    const value = row[metric];
    const previous = sums.get(row.modelId);
    sums.set(
      row.modelId,
      value === undefined || (sums.has(row.modelId) && previous === undefined)
        ? undefined
        : (previous ?? 0) + value,
    );
  }
  return [...sums]
    .filter(
      (entry): entry is [string, number] =>
        entry[1] !== undefined && Number.isFinite(entry[1]) && entry[1] >= 0,
    )
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export function aggregateChartTimeline(
  buckets: RelayUsageBucket[],
  metric: Metric,
  daily: boolean,
  models: string[],
) {
  const points = new Map<number, Record<string, number>>();
  for (const bucket of buckets) {
    const index = models.indexOf(bucket.modelId);
    if (index < 0) continue;
    const date = new Date(bucket.timestamp * 1000);
    if (daily) date.setHours(0, 0, 0, 0);
    else date.setMinutes(0, 0, 0);
    const time = date.getTime();
    if (!Number.isFinite(time)) continue;
    const point = points.get(time) ?? { time };
    const key = "m" + index;
    point[key] = (point[key] ?? 0) + bucket[metric];
    points.set(time, point);
  }
  return [...points.values()].sort((a, b) => a.time - b.time);
}

export function UsageCharts({
  rows,
  buckets,
  account,
  modelFilter,
}: {
  rows: RelayUsageModelRow[];
  buckets?: RelayUsageBucket[];
  account?: RelayAccountInfo;
  modelFilter: string;
}) {
  const { t, i18n } = useTranslation("relaydesk");
  const [metric, setMetric] = useViewPreference<Metric>(
    "usage-metric",
    "totalTokens",
    ["totalTokens", "requestCount", "chargedQuota"],
  );
  const [view, setView] = useViewPreference("usage-chart", "trend", [
    "trend",
    "bar",
    "pie",
  ]);
  const [grain, setGrain] = useViewPreference("usage-grain", "hour", [
    "hour",
    "day",
  ]);
  const daily = grain === "day";
  const modelColors = useRef(new Map<string, string>());
  const modelPatterns = useRef(new Map<string, ModelChartPattern>());
  const allModelNames = rows.map((row) => row.modelId);
  modelColors.current = assignModelColors(allModelNames, modelColors.current);
  modelPatterns.current = assignModelPatterns(
    allModelNames,
    modelPatterns.current,
  );
  const colorFor = (name: string) => modelColors.current.get(name)!;
  const patternFor = (name: string) => modelPatterns.current.get(name)!;
  const ranking = useMemo(
    () => aggregateChartModels(rows, metric),
    [rows, metric],
  );
  const visible = ranking.filter(
    (row) => modelFilter === "all" || row.name === modelFilter,
  );
  const names = visible.map((row) => row.name);
  const timeline = aggregateChartTimeline(buckets ?? [], metric, daily, names);
  const total = visible.reduce((sum, row) => sum + row.value, 0);
  const label = t(
    metric === "totalTokens"
      ? "usageTotalTokens"
      : metric === "requestCount"
        ? "usageRequests"
        : "usageCharged",
  );
  const number = (value: number) =>
    metric === "chargedQuota" && account
      ? formatRelayQuota(value, account)
      : new Intl.NumberFormat(i18n.language, {
          maximumFractionDigits: 2,
        }).format(value) + (metric === "chargedQuota" ? " quota" : "");
  const compact = (value: number) =>
    metric === "chargedQuota"
      ? number(value)
      : new Intl.NumberFormat(i18n.language, { notation: "compact" }).format(
          value,
        );
  const timeLabel = (value: number, full = false) =>
    new Date(value).toLocaleString(i18n.language, {
      month: "short",
      day: "numeric",
      ...(daily && !full ? {} : { hour: "2-digit", minute: "2-digit" }),
    });
  const tooltipStyle = {
    background: "var(--rd-surface)",
    border: "1px solid var(--rd-line)",
    borderRadius: 10,
    color: "var(--rd-text)",
    fontSize: 12,
  };
  const tooltipItemStyle = { color: "var(--rd-text)" };
  return (
    <section
      className={"rd-usage-charts rd-usage-charts-" + view}
      aria-label={t("usageVisuals")}
    >
      <div className="rd-usage-toolbar">
        <h2>{t("usageVisuals")}</h2>
        <div className="rd-chart-control">
          <label htmlFor="rd-chart-view">{t("usageChartView")}</label>
          <select
            id="rd-chart-view"
            className="rd-select"
            value={view}
            onChange={(event) =>
              setView(event.target.value as "trend" | "bar" | "pie")
            }
          >
            <option value="trend">{t("usageViewTrend")}</option>
            <option value="bar">{t("usageViewBar")}</option>
            <option value="pie">{t("usageViewPie")}</option>
          </select>
        </div>
        <div className="rd-chart-control">
          <label htmlFor="rd-chart-metric">{t("usageChartMetric")}</label>
          <select
            id="rd-chart-metric"
            className="rd-select"
            value={metric}
            onChange={(event) => setMetric(event.target.value as Metric)}
          >
            <option value="totalTokens">{t("usageTotalTokens")}</option>
            <option value="requestCount">{t("usageRequests")}</option>
            <option value="chargedQuota">{t("usageCharged")}</option>
          </select>
        </div>
        {view === "trend" && (
          <div className="rd-chart-control">
            <label htmlFor="rd-chart-grain">{t("usageChartGrain")}</label>
            <select
              id="rd-chart-grain"
              className="rd-select"
              value={daily ? "day" : "hour"}
              onChange={(event) =>
                setGrain(event.target.value as "hour" | "day")
              }
            >
              <option value="hour">{t("usageHourly")}</option>
              <option value="day">{t("usageDaily")}</option>
            </select>
          </div>
        )}
      </div>
      <div className="rd-chart-workspace">
        {view === "trend" && (
          <div className="rd-chart-card rd-chart-trend">
            <h3>
              {t("usageTrend")} <small>{label}</small>
            </h3>
            {timeline.length ? (
              <div className="rd-chart-canvas" aria-label={t("usageTrend")}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={timeline}
                    margin={{ top: 12, right: 20, bottom: 8, left: 8 }}
                  >
                    <CartesianGrid
                      stroke="var(--rd-line)"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="time"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      ticks={timelineTicks(timeline.map((point) => point.time))}
                      tickFormatter={(value) => timeLabel(Number(value))}
                      tick={{ fontSize: 12, fill: "var(--rd-muted)" }}
                      minTickGap={45}
                    />
                    <YAxis
                      width={68}
                      tickFormatter={compact}
                      tick={{ fontSize: 12, fill: "var(--rd-muted)" }}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      itemStyle={tooltipItemStyle}
                      labelFormatter={(value) => timeLabel(Number(value), true)}
                      formatter={(value) => number(Number(value))}
                    />
                    {names.map((name, i) => (
                      <Line
                        key={name}
                        name={name}
                        dataKey={"m" + i}
                        stroke={colorFor(name)}
                        strokeWidth={2}
                        strokeDasharray={patternFor(name).strokeDasharray}
                        dot={
                          <ModelChartMarker
                            marker={patternFor(name).marker}
                            color={colorFor(name)}
                          />
                        }
                        activeDot={
                          <ModelChartMarker
                            marker={patternFor(name).marker}
                            color={colorFor(name)}
                            size={4.5}
                          />
                        }
                        type="linear"
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="rd-account-empty">{t("usageTrendEmpty")}</p>
            )}
            <p className="rd-muted">{t("usageChartCoverage")}</p>
          </div>
        )}
        {view === "bar" && (
          <div className="rd-chart-card">
            <h3>
              {t("usageModelComparison")} <small>{label}</small>
            </h3>
            {visible.length ? (
              <div
                className="rd-chart-bars"
                style={{ height: Math.max(220, visible.length * 40) }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={visible}
                    layout="vertical"
                    margin={{ top: 8, right: 20, bottom: 8, left: 10 }}
                  >
                    <XAxis
                      type="number"
                      tickFormatter={compact}
                      tick={{ fontSize: 12, fill: "var(--rd-muted)" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={148}
                      tick={{ fontSize: 12, fill: "var(--rd-muted)" }}
                      tickFormatter={(value) =>
                        String(value).length > 22
                          ? String(value).slice(0, 21) + "…"
                          : String(value)
                      }
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      itemStyle={tooltipItemStyle}
                      formatter={(value) => [number(Number(value)), label]}
                    />
                    <Bar
                      dataKey="value"
                      radius={[0, 4, 4, 0]}
                      isAnimationActive={false}
                    >
                      {visible.map((row) => (
                        <Cell key={row.name} fill={colorFor(row.name)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p>{t("usageNoData")}</p>
            )}
          </div>
        )}
        {view === "pie" && (
          <div className="rd-chart-card">
            <h3>
              {t("usageModelShare")} <small>{label}</small>
            </h3>
            {total > 0 ? (
              <div className="rd-chart-donut">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={visible}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={64}
                      outerRadius={92}
                      paddingAngle={2}
                      isAnimationActive={false}
                    >
                      {visible.map((row) => (
                        <Cell
                          key={row.name}
                          fill={colorFor(row.name)}
                          stroke="var(--rd-surface)"
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      itemStyle={tooltipItemStyle}
                      formatter={(value) => number(Number(value))}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p>{t("usageNoData")}</p>
            )}
          </div>
        )}
        <aside
          className="rd-chart-breakdown"
          aria-label={t("usageModelBreakdown")}
        >
          <h3>{t("usageModelBreakdown")}</h3>
          <ul className="rd-chart-legend">
            {visible.map((row) => (
              <li
                key={row.name}
                style={{ borderLeftColor: colorFor(row.name) }}
              >
                <svg
                  className="rd-chart-series-key"
                  width={36}
                  height={14}
                  viewBox="0 0 36 14"
                  aria-hidden="true"
                  focusable="false"
                >
                  <line
                    x1={0}
                    y1={7}
                    x2={36}
                    y2={7}
                    stroke={colorFor(row.name)}
                    strokeWidth={2}
                    strokeDasharray={patternFor(row.name).strokeDasharray}
                  />
                  <ModelChartMarker
                    cx={18}
                    cy={7}
                    marker={patternFor(row.name).marker}
                    color={colorFor(row.name)}
                  />
                </svg>
                <span>{row.name}</span>
                <strong>{number(row.value)}</strong>
                <small>
                  {total > 0 ? ((row.value / total) * 100).toFixed(1) : "0"}%
                </small>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
