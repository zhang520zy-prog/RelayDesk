import {
  ArrowUpRight,
  Check,
  Circle,
  AlertCircle,
  Layers3,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RelayAccountInfo } from "@/lib/api/relay";
import {
  type ApplyReport,
  targetIds,
  targetLabels,
} from "../state/useRelayApply";
import { Action } from "../ui";
export function CurrentModelCard({
  account,
  report,
  pending,
  onDetails,
}: {
  account: RelayAccountInfo;
  report: ApplyReport | null;
  pending: boolean;
  onDetails: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const same =
    report?.group === account.lastApplied?.group &&
    report?.model === account.lastApplied?.model;
  const status = report
    ? report.phase
    : account.lastApplied
      ? "unverified"
      : "syncIdle";
  return (
    <section
      className={
        "rd-current" + (!account.lastApplied && !report ? " is-empty" : "")
      }
    >
      <div className="rd-current-icon">
        <Layers3 size={23} />
      </div>
      <div className="rd-current-body">
        <div className="rd-section-eyebrow">
          {t(!report && account.lastApplied ? "lastApplied" : "current")}
          <span className={`rd-status ${report?.phase ?? "idle"}`}>
            <i className="rd-dot" />
            {t(status)}
          </span>
        </div>
        <div className="rd-current-model">
          {account.lastApplied ? (
            <>
              <strong title={account.lastApplied.model}>
                {account.lastApplied.model}
              </strong>
              <span className="rd-chip">{account.lastApplied.group}</span>
            </>
          ) : (
            <strong>{t("notApplied")}</strong>
          )}
        </div>
        {account.lastApplied ? (
          <div className="rd-target-statuses">
            {targetIds.map((id) => {
              const result = same
                ? report?.results.find((item) => item.app === id)
                : undefined;
              const label = !account.applyApps[id]
                ? "disabled"
                : result
                  ? result.ok
                    ? "synced"
                    : "syncFailed"
                  : "unverified";
              return (
                <span
                  key={id}
                  className={
                    result?.ok && account.applyApps[id]
                      ? "rd-success-text"
                      : "rd-muted"
                  }
                  title={t(label)}
                >
                  {targetLabels[id]}
                  {!account.applyApps[id] ? (
                    "—"
                  ) : result ? (
                    result.ok ? (
                      <Check size={13} />
                    ) : (
                      <AlertCircle size={13} />
                    )
                  ) : (
                    <Circle size={9} />
                  )}
                </span>
              );
            })}
          </div>
        ) : (
          <p>{t("notAppliedHint")}</p>
        )}
      </div>
      {report && (
        <Action className="rd-current-details" onClick={onDetails}>
          {t(pending ? report.phase : "details")}
          <ArrowUpRight size={14} />
        </Action>
      )}
    </section>
  );
}
