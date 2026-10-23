import { useMemo } from "react";
import {
  Search,
  X,
  Boxes,
  Wallet,
  BarChart3,
  Layers,
  Package,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type RelayAccountInfo,
  type RelayGroup,
  type RelayGroupModels,
  type RelayTarget,
  formatRelayQuota,
} from "@/lib/api/relay";
import { Action, Field } from "../ui";
import type { ApplyReport } from "../state/useRelayApply";
import { CurrentModelCard } from "./CurrentModelCard";
import { ModelGroupCards } from "./ModelGroupCards";
import { ModelTargetQuickBar } from "./ModelTargetQuickBar";
import {
  groupMatchesProgram,
  uniqueModelCount,
  type ModelProgram,
} from "./modelPresentation";
import { TOOL_VENDORS } from "../environment/toolIcons";

/** 目录分区顺序：relay 目标在前、deploy-only 殿后；不属于任何家族的分组进"其他"。 */
const PROGRAM_ORDER: ModelProgram[] = [
  "claude",
  "codex",
  "gemini",
  "grok",
  "devin",
];
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
  filters: { search: string; program?: ModelProgram | null };
  onFiltersChange: (filters: {
    search: string;
    program?: ModelProgram | null;
  }) => void;
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
  targets: (app?: RelayTarget) => void;
  viewAccount: () => void;
  viewWallet: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const { search, program = null } = filters;
  const setSearch = (search: string) => onFiltersChange({ ...filters, search });
  const setProgram = (program: ModelProgram | null) =>
    onFiltersChange({ ...filters, program });
  const groupNames = [
    ...new Set([...groups.map((g) => g.name), ...models.map((g) => g.group)]),
  ].sort();
  const visibleModels = useMemo(
    () =>
      program ? models.filter((g) => groupMatchesProgram(g, program)) : models,
    [models, program],
  );
  // 程序化分区：cc-switch 的"按程序看供应商"心智——每个程序一节，未选程序
  // 时全部铺开；识别不了任何家族的分组归入"其他"，选中程序时只有该节。
  const sections = useMemo(() => {
    const order = program ? [program] : PROGRAM_ORDER;
    const out = order
      .map((p) => ({
        program: p as ModelProgram | null,
        groups: visibleModels.filter((g) => groupMatchesProgram(g, p)),
      }))
      .filter((s) => s.groups.length > 0);
    if (!program) {
      const rest = visibleModels.filter(
        (g) => !PROGRAM_ORDER.some((p) => groupMatchesProgram(g, p)),
      );
      if (rest.length > 0) out.push({ program: null, groups: rest });
    }
    return out;
  }, [visibleModels, program]);
  const query = search.trim().toLocaleLowerCase();
  const matchCount = useMemo(() => {
    if (!query) return uniqueModelCount(visibleModels);
    return visibleModels.reduce(
      (sum, g) =>
        sum +
        g.models.filter((m) =>
          [m.id, m.description ?? "", ...(m.tags ?? [])].some((v) =>
            v.toLocaleLowerCase().includes(query),
          ),
        ).length,
      0,
    );
  }, [visibleModels, query]);
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
      <ModelTargetQuickBar
        apps={account.applyApps}
        report={report}
        busy={busy}
        program={program}
        onProgram={setProgram}
        onConfigure={targets}
      />
      {notice && (
        <div className="rd-alert warning" role="alert">
          <span>{t(notice)}</span>
          <Action onClick={() => targets()}>{t("manageTargets")}</Action>
        </div>
      )}
      <section className="rd-catalog">
        <div className="rd-catalog-heading">
          <h2>
            {t("allModels")}
            <span>{t("resultCount", { count: matchCount })}</span>
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
        ) : !models.length ? (
          <div className="rd-empty">
            <Boxes size={30} />
            <h3>{t("emptyModels")}</h3>
            <p>{t("emptyModelsHint")}</p>
            <Action disabled={busy} onClick={refresh}>
              {t("refresh")}
            </Action>
          </div>
        ) : matchCount ? (
          sections.map(({ program: p, groups: sectionGroups }) => {
            const vendor = p ? TOOL_VENDORS[p] : undefined;
            const ProgramIcon = vendor?.Icon ?? Package;
            const programName = vendor?.name ?? t("otherPrograms");
            return (
              <section
                key={p ?? "other"}
                className="rd-program-section"
                aria-label={programName}
              >
                <header className="rd-program-section__head">
                  <span className="rd-program-section__title">
                    <ProgramIcon size={16} />
                    {programName}
                  </span>
                  <span className="rd-program-section__count">
                    {t("programGroupCount", { count: sectionGroups.length })}
                  </span>
                </header>
                <ModelGroupCards
                  groups={sectionGroups}
                  search={search}
                  current={account.lastApplied}
                  {...{ busy, report, apply }}
                />
              </section>
            );
          })
        ) : (
          <div className="rd-empty">
            <Search size={30} />
            <h3>{t("noResults")}</h3>
            <Action onClick={() => setSearch("")}>{t("clearSearch")}</Action>
          </div>
        )}
      </section>
    </div>
  );
}
