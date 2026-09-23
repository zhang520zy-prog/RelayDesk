import { useMemo } from "react";
import { Search, X, Boxes, Wallet, BarChart3, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type RelayAccountInfo,
  type RelayGroup,
  type RelayGroupModels,
  formatRelayQuota,
} from "@/lib/api/relay";
import { Action, Field } from "../ui";
import type { ApplyReport } from "../state/useRelayApply";
import { CurrentModelCard } from "./CurrentModelCard";
import { ModelTable } from "./ModelTable";
import { modelChoices, uniqueModelCount } from "./modelPresentation";
export function ModelCenterPage({
  account,
  groups,
  models,
  loading,
  loadingError,
  fetching,
  busy,
  report,
  pending,
  notice,
  refresh,
  apply,
  details,
  targets,
  viewAccount,
  viewWallet,
  filters,
  onFiltersChange,
}: {
  filters: { search: string; group: string };
  onFiltersChange: (filters: { search: string; group: string }) => void;
  account: RelayAccountInfo;
  groups: RelayGroup[];
  models: RelayGroupModels[];
  loading: boolean;
  loadingError: boolean;
  fetching: boolean;
  busy: boolean;
  report: ApplyReport | null;
  pending: boolean;
  notice: string | null;
  refresh: () => void;
  apply: (group: string, model: string) => void;
  details: () => void;
  targets: () => void;
  viewAccount: () => void;
  viewWallet: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const { group, search } = filters;
  const setGroup = (group: string) => onFiltersChange({ ...filters, group });
  const setSearch = (search: string) => onFiltersChange({ ...filters, search });
  const groupNames = [
    ...new Set([...groups.map((g) => g.name), ...models.map((g) => g.group)]),
  ].sort();
  const choices = useMemo(
    () => modelChoices(models, group, search, account.lastApplied),
    [models, group, search, account.lastApplied],
  );
  const metrics = [
    {
      key: "balance",
      value: formatRelayQuota(account.quota, account),
      Icon: Wallet,
    },
    {
      key: "used",
      value: formatRelayQuota(account.usedQuota, account),
      Icon: BarChart3,
    },
    {
      key: "availableModels",
      value: loading ? "—" : uniqueModelCount(models),
      Icon: Boxes,
    },
    { key: "groups", value: loading ? "—" : groupNames.length, Icon: Layers },
  ];
  return (
    <div className="rd-model-center">
      <section className="rd-metrics">
        {metrics.map(({ key, value, Icon }) => (
          <div
            className={`rd-metric ${key === "balance" ? "rd-balance" : ""}`}
            key={key}
          >
            <span>
              <Icon size={15} />
              {t(key)}
            </span>
            <strong>{value}</strong>
            {key === "balance" && (
              <div className="rd-metric-links">
                <button onClick={viewAccount}>{t("viewAccount")} ↗</button>
                <button onClick={viewWallet}>{t("topup")} ↗</button>
              </div>
            )}
          </div>
        ))}
      </section>
      <CurrentModelCard {...{ account, report, pending }} onDetails={details} />
      {notice && (
        <div className="rd-alert warning" role="alert">
          <span>{t(notice)}</span>
          <Action onClick={targets}>{t("manageTargets")}</Action>
        </div>
      )}
      <section className="rd-catalog">
        <div className="rd-catalog-heading">
          <h2>
            {t("allModels")}
            <span>{t("resultCount", { count: choices.length })}</span>
          </h2>
          {fetching && !loading && (
            <small className="rd-muted" role="status">
              {t("refreshing")}
            </small>
          )}
        </div>
        <div className="rd-model-toolbar">
          <div className="rd-search">
            <Search size={17} />
            <Field
              type="search"
              aria-label={t("search")}
              placeholder={t("search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                aria-label={t("clearSearch")}
                onClick={() => setSearch("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <select
            className="rd-select"
            aria-label={t("groups")}
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="">{t("allGroups")}</option>
            {groupNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {loadingError && models.length > 0 && (
          <div role="alert" className="rd-alert warning">
            {t("staleModels")}
            <Action onClick={refresh} disabled={busy}>
              {t("retry")}
            </Action>
          </div>
        )}
        {loading ? (
          <div
            className="rd-list-skeleton"
            aria-label={t("loadingModels")}
            role="status"
          >
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i}>
                <i />
                <span />
                <b />
              </div>
            ))}
          </div>
        ) : loadingError && !models.length ? (
          <div className="rd-empty" role="alert">
            <Boxes size={30} />
            <h3>{t("modelsFailed")}</h3>
            <Action onClick={refresh} disabled={busy}>
              {t("retry")}
            </Action>
          </div>
        ) : choices.length ? (
          <ModelTable
            {...{ choices, busy, apply, report }}
            current={account.lastApplied}
          />
        ) : (
          <div className="rd-empty">
            <Search size={30} />
            <h3>
              {t(search ? "noResults" : group ? "emptyGroup" : "emptyModels")}
            </h3>
            {search ? (
              <Action onClick={() => setSearch("")}>{t("clearSearch")}</Action>
            ) : (
              <>
                <p>{t("emptyModelsHint")}</p>
                <Action disabled={busy} onClick={refresh}>
                  {t("refresh")}
                </Action>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
