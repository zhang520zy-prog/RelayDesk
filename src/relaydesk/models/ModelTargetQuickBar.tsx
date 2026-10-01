import { Bot, Code, Sparkles, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type RelayApplyApps, type RelayTarget } from "@/lib/api/relay";
import {
  targetIds,
  targetLabels,
  type ApplyReport,
} from "../state/useRelayApply";
import { Action } from "../ui";

const targetIcons: Record<RelayTarget, typeof Bot> = {
  claude: Bot,
  codex: Code,
  gemini: Sparkles,
};

export function ModelTargetQuickBar({
  apps,
  report,
  busy,
  onConfigure,
}: {
  apps: RelayApplyApps;
  report: ApplyReport | null;
  busy: boolean;
  onConfigure: (app?: RelayTarget) => void;
}) {
  const { t } = useTranslation("relaydesk");
  return (
    <section className="rd-target-quick-bar" aria-label={t("applyTargets")}>
      <div className="rd-target-quick-bar__icons">
        {targetIds.map((app) => {
          const Icon = targetIcons[app];
          const enabled = apps[app];
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
          return (
            <button
              key={app}
              type="button"
              className={`rd-target-quick-bar__chip rd-target-quick-bar__chip--${state}`}
              onClick={() => onConfigure(app)}
              disabled={busy}
              aria-label={`${targetLabels[app]} · ${t(stateKey)}`}
              title={`${targetLabels[app]} · ${t(stateKey)}`}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{targetLabels[app]}</span>
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
