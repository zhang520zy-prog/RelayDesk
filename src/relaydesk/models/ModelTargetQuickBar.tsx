import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type RelayApplyApps, type RelayTarget } from "@/lib/api/relay";
import {
  deployOnlyIds,
  targetIds,
  targetLabels,
  type ApplyReport,
} from "../state/useRelayApply";
import { TOOL_VENDORS } from "../environment/toolIcons";
import { Action } from "../ui";

export function ModelTargetQuickBar({
  apps,
  report,
  busy,
  onConfigure,
  onDeployOnly,
}: {
  apps: RelayApplyApps;
  report: ApplyReport | null;
  busy: boolean;
  onConfigure: (app?: RelayTarget) => void;
  /** 仅部署、不接中转站写入的工具（Devin）点击时跳环境部署页 */
  onDeployOnly?: (id: string) => void;
}) {
  const { t } = useTranslation("relaydesk");
  return (
    <section className="rd-target-quick-bar" aria-label={t("applyTargets")}>
      <div className="rd-target-quick-bar__icons">
        {targetIds.map((app) => {
          const vendor = TOOL_VENDORS[app];
          const enabled = apps?.[app];
          const result = report?.results.find((r) => r.app === app);
          const state = !enabled
            ? "disabled"
            : result?.ok
              ? "synced"
              : result
                ? "failed"
                : "pending";
          const stateKey =
            state === "pending"
              ? "syncPending"
              : state === "failed"
                ? "syncFailed"
                : state;
          const name = vendor?.name ?? targetLabels[app];
          return (
            <button
              key={app}
              type="button"
              className={`rd-target-quick-bar__chip rd-target-quick-bar__chip--${state}`}
              onClick={() => onConfigure(app)}
              disabled={busy}
              aria-label={`${name} · ${t(stateKey)}`}
              title={`${name} · ${t(stateKey)}`}
            >
              {vendor ? <vendor.Icon size={17} /> : null}
              <span>{name}</span>
            </button>
          );
        })}
        {/* 仅部署工具（Devin 走自有账号体系，不接中转站配置）：
            与环境部署页 AI 工具行对齐展示，点击去部署页 */}
        {deployOnlyIds.map((id) => {
          const vendor = TOOL_VENDORS[id];
          const name = vendor?.name ?? id;
          return (
            <button
              key={id}
              type="button"
              className="rd-target-quick-bar__chip rd-target-quick-bar__chip--deploy"
              onClick={() => onDeployOnly?.(id)}
              aria-label={name}
              title={name}
            >
              {vendor ? <vendor.Icon size={17} /> : null}
              <span>{name}</span>
            </button>
          );
        })}
      </div>
      <Action onClick={() => onConfigure()} disabled={busy}>
        <Settings2 size={14} />
        {t("manageTargets")}
      </Action>
    </section>
  );
}
