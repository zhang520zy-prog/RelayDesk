import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Clock3,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatRelayMoney,
  formatRelayQuota,
  type RelayAccountInfo,
  relayApi,
  type RelayUsageModelRow,
  type RelayUsageQuery,
} from "@/lib/api/relay";
import { Action } from "../ui";
import "./account.css";
import { useViewPreference } from "../state/useViewPreference";
import { UsageCharts } from "./UsageCharts";
import { relayErrorKey } from "../state/relayErrors";

type Range = "24h" | "today" | "7d" | "30d";

function queryForRange(range: Range): RelayUsageQuery {
  const end = new Date();
  const days =
    range === "today" || range === "24h" ? 1 : range === "30d" ? 30 : 7;
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  if (range === "today") start.setTime(new Date(end).setHours(0, 0, 0, 0));
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pageSize: 100,
  };
}

function numberValue(value?: number) {
  return value === undefined || value === null
    ? "—"
    : new Intl.NumberFormat().format(value);
}

function chargedValue(row: RelayUsageModelRow, account?: RelayAccountInfo) {
  if (row.chargedAmount !== undefined)
    return formatRelayMoney(row.chargedAmount, {
      currencySymbol: row.currencySymbol,
      currencyCode: row.currency,
    });
  if (row.chargedQuota !== undefined)
    return account
      ? formatRelayQuota(row.chargedQuota, account)
      : numberValue(row.chargedQuota) + " quota";
  return "—";
}

export function UsagePage({
  account,
  onSessionExpired,
}: {
  account?: RelayAccountInfo;
  onSessionExpired?: (error: unknown) => void;
}) {
  const { t, i18n } = useTranslation("relaydesk");
  const expiredNotified = useRef(false);
  const notifySessionExpired = useCallback(
    (error: unknown) => {
      if (
        !onSessionExpired ||
        relayErrorKey(error) !== "expired" ||
        expiredNotified.current
      )
        return;
      expiredNotified.current = true;
      onSessionExpired(error);
    },
    [onSessionExpired],
  );
  const [modelFilter, setModelFilter] = useState("all");
  const [range, setRange] = useViewPreference<Range>("usage-range", "24h", [
    "24h",
    "today",
    "7d",
    "30d",
  ]);
  const [sort, setSort] = useState<{
    key: keyof RelayUsageModelRow;
    descending: boolean;
  }>({ key: "totalTokens", descending: true });
  const toggleSort = (key: keyof RelayUsageModelRow) =>
    setSort((current) => ({
      key,
      descending:
        current.key === key
          ? !current.descending
          : key !== "displayName" && key !== "group",
    }));
  const [refreshVersion, setRefreshVersion] = useState(0);
  const query = useMemo(() => queryForRange(range), [range, refreshVersion]);
  const models = useQuery({
    queryKey: ["relaydesk", "usage-models", query],
    queryFn: () => relayApi.getUsageModels(query),
    retry: false,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (models.error) notifySessionExpired(models.error);
  }, [models.error, notifySessionExpired]);
  const rows = models.data?.items ?? [];
  const selectedModel =
    models.isSuccess &&
    modelFilter !== "all" &&
    !rows.some((row) => row.modelId === modelFilter)
      ? "all"
      : modelFilter;
  const visibleRows = rows.filter(
    (row) => selectedModel === "all" || row.modelId === selectedModel,
  );
  const sortedRows = [...visibleRows].sort((a, b) => {
    const sortValue = (row: RelayUsageModelRow) => {
      if (sort.key === "chargedAmount" && row.chargedAmount != null) {
        const amount = Number(row.chargedAmount);
        return Number.isFinite(amount) ? amount : undefined;
      }
      return row[sort.key];
    };
    const x = sortValue(a),
      y = sortValue(b);
    if (x == null) return y == null ? 0 : 1;
    if (y == null) return -1;
    const difference =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y));
    return sort.descending ? -difference : difference;
  });
  const sum = (field: "requestCount" | "totalTokens" | "chargedQuota") =>
    models.data && visibleRows.every((row) => row[field] != null)
      ? visibleRows.reduce((total, row) => total + (row[field] ?? 0), 0)
      : undefined;
  const overview = {
    requestCount: sum("requestCount"),
    totalTokens: sum("totalTokens"),
    chargedQuota: sum("chargedQuota"),
  };
  const has = (field: keyof RelayUsageModelRow) =>
    visibleRows.some(
      (row) =>
        row[field] !== undefined && row[field] !== null && row[field] !== "",
    );
  const columns: {
    key: keyof RelayUsageModelRow;
    label: string;
    render: (row: RelayUsageModelRow) => React.ReactNode;
  }[] = [
    {
      key: "group",
      label: "usageGroup",
      render: (row: RelayUsageModelRow) => row.group ?? "—",
    },
    {
      key: "requestCount",
      label: "usageRequests",
      render: (row: RelayUsageModelRow) => numberValue(row.requestCount),
    },
    {
      key: "inputTokens",
      label: "usageInputTokens",
      render: (row: RelayUsageModelRow) => numberValue(row.inputTokens),
    },
    {
      key: "outputTokens",
      label: "usageOutputTokens",
      render: (row: RelayUsageModelRow) => numberValue(row.outputTokens),
    },
    {
      key: "cacheReadTokens",
      label: "usageCacheRead",
      render: (row: RelayUsageModelRow) => numberValue(row.cacheReadTokens),
    },
    {
      key: "cacheWriteTokens",
      label: "usageCacheWrite",
      render: (row: RelayUsageModelRow) => numberValue(row.cacheWriteTokens),
    },
    {
      key: "totalTokens",
      label: "usageTotalTokens",
      render: (row: RelayUsageModelRow) => numberValue(row.totalTokens),
    },
    {
      key: has("chargedQuota") ? "chargedQuota" : "chargedAmount",
      label: "usageCharged",
      render: (row: RelayUsageModelRow) => chargedValue(row, account),
    },
  ].filter(
    (column) =>
      has(column.key as keyof RelayUsageModelRow) ||
      (column.key === "chargedQuota" && has("chargedAmount")),
  ) as typeof columns;

  return (
    <div className="rd-account-page rd-usage-page">
      <section className="rd-usage-filter-panel" aria-label={t("usageFilters")}>
        <div className="rd-usage-toolbar">
          <label htmlFor="rd-usage-range">{t("usageRange")}</label>
          <select
            id="rd-usage-range"
            className="rd-select"
            value={range}
            onChange={(event) => setRange(event.target.value as Range)}
          >
            <option value="24h">{t("usage24h")}</option>
            <option value="today">{t("usageToday")}</option>
            <option value="7d">{t("usage7d")}</option>
            <option value="30d">{t("usage30d")}</option>
          </select>
          <label htmlFor="rd-model-filter">{t("usageTableModel")}</label>
          <select
            id="rd-model-filter"
            className="rd-select"
            value={selectedModel}
            onChange={(event) => setModelFilter(event.target.value)}
          >
            <option value="all">{t("usageAllModels")}</option>
            {[
              ...new Set(models.data?.items.map((row) => row.modelId) ?? []),
            ].map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <Action
            onClick={() => {
              setRefreshVersion((version) => version + 1);
            }}
            disabled={models.isFetching}
          >
            <RefreshCw
              size={15}
              className={models.isFetching ? "rd-spin" : ""}
            />
            {t(models.isFetching ? "refreshing" : "usageRefresh")}
          </Action>
        </div>

        <p className="rd-usage-window">
          {t("usageWindow")}:{" "}
          {new Date(query.start).toLocaleString(i18n.language)} —{" "}
          {new Date(query.end).toLocaleString(i18n.language)}
        </p>
        <section className="rd-usage-meta" aria-label={t("usageAccount")}>
          <span>
            <Clock3 size={14} />
            {t("usageTimezone")} · {query.timezone ?? "—"}
          </span>
        </section>
      </section>

      <section
        className="rd-usage-metrics"
        aria-label={t("usageFilteredTotals")}
      >
        <div>
          <span>{t("usageRequests")}</span>
          <strong>{numberValue(overview?.requestCount)}</strong>
        </div>
        <div>
          <span>{t("usageTotalTokens")}</span>
          <strong>{numberValue(overview?.totalTokens)}</strong>
        </div>
        <div>
          <span>{t("usageCharged")}</span>
          <strong>
            {overview.chargedQuota === undefined
              ? "—"
              : account
                ? formatRelayQuota(overview.chargedQuota, account)
                : numberValue(overview.chargedQuota) + " quota"}
          </strong>
        </div>
      </section>

      {models.data && (
        <UsageCharts
          rows={models.data.items}
          buckets={models.data.buckets}
          account={account}
          modelFilter={selectedModel}
        />
      )}

      {models.data?.detailsStatus &&
        ["failed", "incomplete"].includes(models.data.detailsStatus) && (
          <p className="rd-muted" role="status">
            {t("usageLogsUnavailable")}
          </p>
        )}
      <section className="rd-account-card rd-usage-table-card">
        <div className="rd-account-section-heading">
          <div>
            <span className="rd-section-eyebrow">{t("usage")}</span>
            <h2>{t("usageModels")}</h2>
            {(has("inputTokens") || has("outputTokens")) && (
              <p className="rd-muted">{t("usageDetailSource")}</p>
            )}
          </div>
          {models.isFetching && (
            <span className="rd-muted" role="status">
              {t("usageLoading")}
            </span>
          )}
        </div>
        {models.isPending ? (
          <p className="rd-account-loading" role="status">
            {t("usageLoading")}
          </p>
        ) : models.isError ? (
          <div className="rd-account-state" role="alert">
            <AlertCircle size={18} />
            <div>
              <h3>{t("usageModelsUnavailable")}</h3>
              <p>{t("usageModelsUnavailableHint")}</p>
              <Action onClick={() => void models.refetch()}>
                {t("usageRefresh")}
              </Action>
            </div>
          </div>
        ) : visibleRows.length ? (
          <div
            className="rd-account-table-scroll"
            role="region"
            aria-label={t("usageModels")}
            tabIndex={0}
          >
            <table className="rd-account-table rd-usage-table">
              <thead>
                <tr>
                  <th
                    scope="col"
                    aria-sort={
                      sort.key === "displayName"
                        ? sort.descending
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    <button
                      className="rd-table-sort"
                      onClick={() => toggleSort("displayName")}
                    >
                      {t("usageModel")}
                      <ArrowUpDown size={13} aria-hidden="true" />
                    </button>
                  </th>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={column.key === "group" ? "" : "rd-numeric"}
                      aria-sort={
                        sort.key === column.key
                          ? sort.descending
                            ? "descending"
                            : "ascending"
                          : "none"
                      }
                    >
                      <button
                        className="rd-table-sort"
                        onClick={() => toggleSort(column.key)}
                      >
                        {t(column.label)}
                        {sort.key === column.key ? (
                          sort.descending ? (
                            <ArrowDown size={13} aria-hidden="true" />
                          ) : (
                            <ArrowUp size={13} aria-hidden="true" />
                          )
                        ) : (
                          <ArrowUpDown size={13} aria-hidden="true" />
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.modelId + ":" + (row.group ?? "")}>
                    <td>
                      <strong>{row.displayName}</strong>
                      {row.detailsReconciled === false && (
                        <small>
                          {t("usageLogCoverage", {
                            count: row.detailRequestCount,
                          })}
                        </small>
                      )}
                    </td>
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={column.key === "group" ? "" : "rd-numeric"}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rd-account-empty">{t("usageNoData")}</p>
        )}
      </section>
    </div>
  );
}
