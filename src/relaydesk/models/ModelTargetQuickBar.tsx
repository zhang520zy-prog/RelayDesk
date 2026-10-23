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
import type { ModelProgram } from "./modelPresentation";
import { Action } from "../ui";

export function ModelTargetQuickBar({
  apps,
  report,
  busy,
  program,
  onProgram,
  onConfigure,
}: {
  apps: RelayApplyApps;
  report: ApplyReport | null;
  busy: boolean;
  /** 当前选中的程序筛选；null = 全部 */
  program: ModelProgram | null;
  onProgram: (program: ModelProgram | null) => void;
  onConfigure: (app?: RelayTarget) => void;
}) {
  const { t } = useTranslation("relaydesk");
  return (
    <section className="rd-target-quick-bar" aria-label={t("applyTargets")}>
      <div className="rd-target-quick-bar__icons" role="tablist">
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
          const active = program === app;
          return (
            <button
              key={app}
              type="button"
              role="tab"
              aria-selected={active}
              className={`rd-target-quick-bar__chip rd-target-quick-bar__chip--${state}${active ? " rd-target-quick-bar__chip--active" : ""}`}
              onClick={() => onProgram(active ? null : app)}
              disabled={busy}
              aria-label={`${name} · ${t(stateKey)}`}
              title={`${name} · ${t(stateKey)}`}
            >
              {vendor ? <vendor.Icon size={17} /> : null}
              <span>{name}</span>
            </button>
          );
        })}
        {/* deploy-only 工具（Devin）同样作为程序筛选 chip：只显示其家族分组 */}
        {deployOnlyIds.map((id) => {
          const vendor = TOOL_VENDORS[id];
          const name = vendor?.name ?? id;
          const active = program === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`rd-target-quick-bar__chip rd-target-quick-bar__chip--deploy${active ? " rd-target-quick-bar__chip--active" : ""}`}
              onClick={() => onProgram(active ? null : id)}
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
