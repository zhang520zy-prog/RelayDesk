import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  Check,
  FolderSearch,
  Bot,
  Code,
  Sparkles,
  Info,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
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

const targetIcons: Record<RelayTarget, typeof Bot> = {
  claude: Bot,
  codex: Code,
  gemini: Sparkles,
};

function TargetCard({
  app,
  apps,
  busy,
  report,
  change,
  focused,
}: {
  app: RelayTarget;
  apps: RelayApplyApps;
  busy: boolean;
  report: ApplyReport | null;
  change: (apps: RelayApplyApps) => void;
  focused?: boolean;
}) {
  const { t } = useTranslation("relaydesk");
  const queryClient = useQueryClient();
  const path = useQuery({
    queryKey: ["relaydesk", "targetPath", app],
    queryFn: () => settingsApi.getConfigDir(app),
    staleTime: Infinity,
    retry: false,
  });
  const refreshPath = () =>
    queryClient.invalidateQueries({
      queryKey: ["relaydesk", "targetPath", app],
    });
  const browsePath = async () => {
    try {
      const picked = await settingsApi.selectConfigDirectory(path.data);
      if (!picked) return;
      await settingsApi.setTargetConfigDir(app, picked);
      await refreshPath();
      toast.success(t("pathUpdated"));
    } catch {
      toast.error(t("pathUpdateFailed"));
    }
  };
  const resetPath = async () => {
    try {
      await settingsApi.setTargetConfigDir(app, undefined);
      await refreshPath();
      toast.success(t("pathUpdated"));
    } catch {
      toast.error(t("pathUpdateFailed"));
    }
  };
  const result = report?.results.find((r) => r.app === app);
  const Icon = targetIcons[app];
  const cardRef = useRef<HTMLElement>(null);
  // 只在聚焦状态变更时滚动一次；ref 回调写法会让任意重渲染都把用户拽回来。
  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ block: "center" });
  }, [focused]);
  return (
    <section
      id={`rd-target-${app}`}
      ref={cardRef}
      className={`rd-target-card ${apps[app] ? "is-enabled" : ""} ${focused ? "is-focus" : ""}`}
    >
      <div className="rd-target-card-top">
        <span className={`rd-tool-icon ${app}`}>
          <Icon size={23} aria-hidden="true" />
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
        <button
          type="button"
          className="rd-path-action"
          title={t("browsePath")}
          aria-label={t("browsePath")}
          onClick={browsePath}
        >
          <FolderSearch size={14} />
        </button>
        <button
          type="button"
          className="rd-path-action"
          title={t("resetPath")}
          aria-label={t("resetPath")}
          onClick={resetPath}
        >
          <Undo2 size={14} />
        </button>
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
  focusTarget,
}: {
  focusTarget?: RelayTarget | null;
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
        <TargetCard
          key={app}
          {...{ app, apps, busy, report, change }}
          focused={focusTarget === app}
        />
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
