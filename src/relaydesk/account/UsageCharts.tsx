import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  BarChart,
  Bar,
  LabelList,
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
  { length: 12 },
  (_, index) => "var(--rd-chart-" + (index + 1) + ")",
);

// 与 tokens.css 的 --rd-chart-1..12 对应色相（度），用于相邻扇区对比度检查
const paletteHues = [220, 28, 275, 170, 330, 75, 190, 0, 250, 50, 140, 18];

function paletteIndexOf(color: string) {
  const match = /rd-chart-(\d+)/.exec(color);
  return match ? parseInt(match[1], 10) - 1 : -1;
}

function circularDiff(a: number, b: number) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** 榜单相邻两色若色相差 <45°（如红/橙挨在一起难分辨），
 *  把后一名换成一个未占用、且与前一色相距最远的调色板色。
 *  修改共享 map——图表、明细榜、表格色点三者保持一致。 */
export function ensureAdjacentContrast(
  names: string[],
  map: Map<string, string>,
) {
  let prevHue: number | null = null;
  for (const name of names) {
    const color = map.get(name);
    if (!color) continue;
    const idx = paletteIndexOf(color);
    if (idx < 0) {
      prevHue = null;
      continue;
    }
    let hue = paletteHues[idx];
    if (prevHue !== null && circularDiff(hue, prevHue) < 45) {
      const used = new Set(map.values());
      let best = color;
      let bestDistance = circularDiff(hue, prevHue);
      for (const candidate of colors) {
        if (used.has(candidate) && candidate !== color) continue;
        const candidateIdx = paletteIndexOf(candidate);
        if (candidateIdx < 0) continue;
        const distance = circularDiff(paletteHues[candidateIdx], prevHue);
        if (distance > bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
      if (best !== color) {
        map.set(name, best);
        hue = paletteHues[paletteIndexOf(best)];
      }
    }
    prevHue = hue;
  }
}

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

const chartMarkers = [
  "circle",
  "square",
  "diamond",
  "triangle",
  "star",
  "triangleDown",
] as const;
const chartLinePatterns = [
  undefined,
  "8 4",
  "2 4",
  "8 3 2 3",
  "1 3",
  "12 4",
] as const;
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
  size = 2,
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
      {marker === "triangleDown" && (
        <polygon
          points={`0,${size * 1.25} ${size * 1.1},${-size} ${-size * 1.1},${-size}`}
        />
      )}
      {marker === "star" && (
        <path
          d="M0 -1.55 L0.44 -0.55 L1.5 -0.49 L0.72 0.2 L0.93 1.26 L0 0.62 L-0.93 1.26 L-0.72 0.2 L-1.5 -0.49 L-0.44 -0.55 Z"
          transform={`scale(${size * 1.05})`}
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
  colors,
}: {
  rows: RelayUsageModelRow[];
  buckets?: RelayUsageBucket[];
  account?: RelayAccountInfo;
  modelFilter: string;
  /** 外部共享的模型→颜色映射（明细表与图表同色）；缺省内部自建 */
  colors?: Map<string, string>;
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
  if (!colors)
    modelColors.current = assignModelColors(allModelNames, modelColors.current);
  else modelColors.current = colors;
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
  // 榜单相邻项颜色必须有明显区别（饼图扇区、柱条、明细行共用此约束）
  ensureAdjacentContrast(
    visible.map((row) => row.name),
    modelColors.current,
  );
  // 柱状/饼图只看头部模型：前 9 名 + "其他"合并条，图例区仍展示完整明细
  const CHART_TOP = 9;
  const head = visible.slice(0, CHART_TOP);
  const tail = visible.slice(CHART_TOP);
  const tailSum = tail.reduce((sum, row) => sum + row.value, 0);
  const chartRows: { name: string; value: number; others?: boolean }[] =
    tailSum > 0
      ? [...head, { name: t("usageOthers"), value: tailSum, others: true }]
      : head;
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
                  <ComposedChart
                    data={timeline}
                    margin={{ top: 12, right: 20, bottom: 8, left: 8 }}
                  >
                    <defs>
                      {names.map((name, i) => (
                        <linearGradient
                          key={name}
                          id={`rd-usage-grad-${i}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor={colorFor(name)}
                            stopOpacity={0.28}
                          />
                          <stop
                            offset="100%"
                            stopColor={colorFor(name)}
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      ))}
                    </defs>
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
                      <Area
                        key={name}
                        name={name}
                        dataKey={"m" + i}
                        stroke={colorFor(name)}
                        strokeWidth={2}
                        strokeDasharray={patternFor(name).strokeDasharray}
                        fill={`url(#rd-usage-grad-${i})`}
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
                            size={3.5}
                          />
                        }
                        type="monotone"
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </ComposedChart>
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
            {chartRows.length ? (
              /* 竖向柱状图：X 轴=模型名（贴近常规读法），柱顶直接标注数值 */
              <div className="rd-chart-bars rd-chart-bars-v">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={chartRows}
                    margin={{ top: 22, right: 16, bottom: 6, left: 6 }}
                    barCategoryGap="30%"
                  >
                    {/* 只保留横向 Y 虚线；纵向网格与柱条方向重复易乱 */}
                    <CartesianGrid
                      stroke="var(--rd-line)"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={{ stroke: "var(--rd-line)" }}
                      tick={{ fontSize: 11, fill: "var(--rd-muted)" }}
                      interval={0}
                      angle={-32}
                      textAnchor="end"
                      height={64}
                      tickMargin={4}
                      tickFormatter={(value) =>
                        String(value).length > 16
                          ? String(value).slice(0, 15) + "…"
                          : String(value)
                      }
                    />
                    <YAxis
                      width={56}
                      tickFormatter={compact}
                      tick={{ fontSize: 12, fill: "var(--rd-muted)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      itemStyle={tooltipItemStyle}
                      cursor={{ fill: "var(--rd-hover)" }}
                      formatter={(value) => [number(Number(value)), label]}
                    />
                    <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={56}>
                      {chartRows.map((row) => (
                        <Cell
                          key={row.name}
                          fill={
                            row.others ? "var(--rd-muted)" : colorFor(row.name)
                          }
                        />
                      ))}
                      <LabelList
                        dataKey="value"
                        position="top"
                        formatter={(value: unknown) =>
                          compact(Number(value ?? 0))
                        }
                        fill="var(--rd-muted)"
                        fontSize={11}
                      />
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
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={chartRows}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={68}
                      outerRadius={94}
                      paddingAngle={2}
                      cornerRadius={3}
                      isAnimationActive={false}
                    >
                      {chartRows.map((row) => (
                        <Cell
                          key={row.name}
                          fill={
                            row.others ? "var(--rd-muted)" : colorFor(row.name)
                          }
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
                {/* 环心总量：一眼看到该指标合计 */}
                <div className="rd-chart-donut-total" aria-hidden="true">
                  <strong>{compact(total)}</strong>
                  <small>{label}</small>
                </div>
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
          {/* 明细=排名榜：色点 + 模型 + 占比进度条 + 数值 + 百分比，紧凑清晰 */}
          <ul className="rd-chart-legend">
            {visible.map((row, index) => {
              const share = total > 0 ? (row.value / total) * 100 : 0;
              return (
                <li key={row.name}>
                  <div className="rd-chart-legend-head">
                    <span className="rd-chart-legend-rank">{index + 1}</span>
                    <i
                      className="rd-chart-legend-dot"
                      style={{ background: colorFor(row.name) }}
                      aria-hidden="true"
                    />
                    <span className="rd-chart-legend-name" title={row.name}>
                      {row.name}
                    </span>
                  </div>
                  <div className="rd-chart-legend-stats">
                    <strong>{number(row.value)}</strong>
                    <small>{share.toFixed(1)}%</small>
                  </div>
                  <div
                    className="rd-chart-legend-bar"
                    role="presentation"
                    aria-hidden="true"
                  >
                    <i
                      style={{
                        width: `${Math.min(100, Math.max(1.5, share))}%`,
                        background: colorFor(row.name),
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </section>
  );
}
