import { useState } from "react";
import { Check, AlertCircle, Loader2, X, ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { settingsApi } from "@/lib/api/settings";
import { type RelayApplyApps, type RelayTarget } from "@/lib/api/relay";
import { Action } from "../ui";
import { type ApplyReport, targetLabels } from "../state/useRelayApply";
import { LaunchChoices } from "./LaunchChoices";
export function ApplyProgressDialog({
  report,
  open,
  onOpenChange,
  pending,
  busy,
  apps,
  retry,
  openEnvironment,
}: {
  report: ApplyReport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  busy: boolean;
  apps: RelayApplyApps;
  retry: (app: RelayTarget) => void;
  openEnvironment?: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const [help, setHelp] = useState<RelayTarget | null>(null);
  const [folderError, setFolderError] = useState(false);
  const succeeded =
    report && !pending
      ? (report.launchTargets ?? report.targets).filter((app) =>
          report.results.some((result) => result.app === app && result.ok),
        )
      : [];

  if (!report) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="rd-dialog"
        onCloseAutoFocus={() => setHelp(null)}
      >
        <div className="rd-dialog-top">
          <DialogTitle>{t("applyProgress")}</DialogTitle>
          <Action aria-label={t("close")} onClick={() => onOpenChange(false)}>
            <X size={17} />
          </Action>
        </div>
        <DialogDescription className="rd-dialog-description">
          <span className="rd-mono" title={report.model}>
            {report.model}
          </span>
          <span className="rd-chip" title={report.group}>
            {report.group}
          </span>
        </DialogDescription>
        <div className={`rd-apply-heading ${report.phase}`} role="status">
          {pending ? (
            <Loader2 size={24} className="rd-spin" />
          ) : report.phase === "success" ? (
            <Check size={24} />
          ) : (
            <AlertCircle size={24} />
          )}
          <strong>{t(report.phase)}</strong>
        </div>
        <div className="rd-steps">
          <span className={report.phase === "preparing" ? "is-active" : ""}>
            01 {t("preparing")}
          </span>
          <span className={report.phase === "syncing" ? "is-active" : ""}>
            02 {t("syncing")}
          </span>
        </div>
        <p className="rd-muted rd-small">{t("applyTo")}</p>
        <div className="rd-result-list">
          {report.targets.map((app) => {
            const result = report.results.find((r) => r.app === app);
            return (
              <div key={app} className="rd-result">
                <div>
                  <strong>{targetLabels[app]}</strong>
                  <span
                    className={
                      result?.ok
                        ? "rd-success-text"
                        : result
                          ? "rd-danger-text"
                          : "rd-muted"
                    }
                  >
                    {result ? (
                      result.ok ? (
                        <>
                          <Check size={14} />
                          {t("synced")}
                        </>
                      ) : (
                        <>
                          <AlertCircle size={14} />
                          {t("syncFailed")}
                        </>
                      )
                    ) : (
                      <>
                        <Loader2 size={14} className="rd-spin" />
                        {t("syncPending")}
                      </>
                    )}
                  </span>
                </div>
                {result && !result.ok && !pending && (
                  <div className="rd-result-actions">
                    <Action
                      disabled={busy || !apps[app]}
                      onClick={() => retry(app)}
                    >
                      {t("retryTool")}
                    </Action>
                    <button
                      className="rd-text-button"
                      onClick={() => {
                        setHelp(help === app ? null : app);
                        setFolderError(false);
                      }}
                    >
                      {t("solutions")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {open && succeeded.length > 0 && (
          <LaunchChoices
            key={
              report.operationId ??
              `${report.group}:${report.model}:${succeeded.join(",")}`
            }
            targets={succeeded}
            busy={busy}
            onDismiss={() => onOpenChange(false)}
            openEnvironment={openEnvironment}
          />
        )}
        {report.error && (
          <p className="rd-alert error" role="alert">
            {t(report.error)}
          </p>
        )}
        {report.phase === "failed" && (
          <p className="rd-result-note">{t("failedKeepsPrevious")}</p>
        )}
        {report.phase === "partial" && (
          <p className="rd-result-note">{t("partialHint")}</p>
        )}
        {help && (
          <section className="rd-help">
            <h3>{t("helpTitle")}</h3>
            <p>{t("helpBody")}</p>
            <Action
              onClick={() =>
                void settingsApi
                  .openConfigFolder(help)
                  .catch(() => setFolderError(true))
              }
            >
              {t("openFolder")}
              <ArrowUpRight size={14} />
            </Action>
            {folderError && <p role="alert">{t("genericError")}</p>}
          </section>
        )}
        {(pending || succeeded.length === 0) && (
          <footer className="rd-dialog-footer">
            {pending && <small>{t("backgroundSync")}</small>}
            <Action primary onClick={() => onOpenChange(false)}>
              {t(pending ? "hideProgress" : "close")}
            </Action>
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}
