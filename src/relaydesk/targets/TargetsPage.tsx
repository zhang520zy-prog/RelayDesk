import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Check, Terminal, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { settingsApi } from "@/lib/api/settings";
import {
  type RelayApplyApps,
  type RelayGroup,
  type RelayTarget,
} from "@/lib/api/relay";
import {
  type ApplyReport,
  targetIds,
  targetLabels,
} from "../state/useRelayApply";
import { GroupRouting } from "./GroupRouting";
function TargetCard({
  app,
  apps,
  busy,
  report,
  change,
}: {
  app: RelayTarget;
  apps: RelayApplyApps;
  busy: boolean;
  report: ApplyReport | null;
  change: (apps: RelayApplyApps) => void;
}) {
  const { t } = useTranslation("relaydesk");
  const path = useQuery({
    queryKey: ["relaydesk", "targetPath", app],
    queryFn: () => settingsApi.getConfigDir(app),
    staleTime: Infinity,
    retry: false,
  });
  const result = report?.results.find((r) => r.app === app);
  return (
    <section className={`rd-target-card ${apps[app] ? "is-enabled" : ""}`}>
      <div className="rd-target-card-top">
        <span className={`rd-tool-icon ${app}`}>
          <Terminal size={23} />
        </span>
        <div>
          <h2>{targetLabels[app]}</h2>
          <span className="rd-muted">
            {t(apps[app] ? "enabled" : "disabled")}
          </span>
        </div>
        <label className="rd-target-toggle">
          <span>{t("syncToTool")}</span>
          <Switch
            aria-label={`${targetLabels[app]} · ${t("syncToTool")}`}
            checked={apps[app]}
            disabled={busy}
            onCheckedChange={(checked) => change({ ...apps, [app]: checked })}
          />
        </label>
      </div>
      <div className="rd-target-path">
        <span>{t("configPath")}</span>
        <code title={path.data}>
          {path.data ?? (path.isPending ? "…" : t("pathUnavailable"))}
        </code>
      </div>
      <div className="rd-target-card-bottom">
        <span className={result?.ok ? "rd-success-text" : "rd-muted"}>
          {result ? (
            <>
              {result.ok && <Check size={14} />}
              {t("recentSync")} · {t(result.ok ? "synced" : "syncFailed")}
            </>
          ) : (
            t("statusPending")
          )}
        </span>
        {result?.ok && (
          <span className="rd-mono rd-last-target-model" title={report?.model}>
            {report?.model}
          </span>
        )}
      </div>
    </section>
  );
}
export function TargetsPage({
  apps,
  groups,
  groupTargets,
  groupsLoading,
  groupsError,
  refreshGroups,
  busy,
  routingBusy,
  report,
  change,
  changeGroupTarget,
}: {
  apps: RelayApplyApps;
  groups: RelayGroup[];
  groupTargets: Record<string, RelayTarget>;
  groupsLoading: boolean;
  groupsError: boolean;
  refreshGroups: () => void;
  busy: boolean;
  routingBusy?: boolean;
  report: ApplyReport | null;
  change: (apps: RelayApplyApps) => void;
  changeGroupTarget: (
    group: string,
    target: RelayTarget | null,
  ) => Promise<boolean>;
}) {
  const { t } = useTranslation("relaydesk");
  return (
    <div className="rd-targets-page">
      <div className="rd-page-kicker">
        <span className="rd-status idle">
          <i className="rd-dot" />
          {t("targetsCount", {
            count: targetIds.filter((id) => apps[id]).length,
          })}
        </span>
        <ArrowUpRight size={18} />
      </div>
      {targetIds.map((app) => (
        <TargetCard key={app} {...{ app, apps, busy, report, change }} />
      ))}
      <GroupRouting
        {...{ apps, groups, groupTargets, changeGroupTarget }}
        busy={routingBusy ?? busy}
        loading={groupsLoading}
        loadingError={groupsError}
        refresh={refreshGroups}
      />
      <p className="rd-info-note">
        <Info size={17} />
        {t("targetNotice")}
      </p>
    </div>
  );
}
