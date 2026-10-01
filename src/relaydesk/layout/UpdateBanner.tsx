import {
  Loader2,
  RefreshCw,
  Download,
  X,
  AlertTriangle,
  Check,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Action } from "../ui";

export type UpdateBannerStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "latest" }
  | { kind: "not_configured" }
  | { kind: "check_failed" }
  | { kind: "install_failed" }
  | { kind: "installing" };

export function UpdateBanner({
  status,
  onCheck,
  onInstall,
  onDismiss,
  onOpenSettings,
}: {
  status: UpdateBannerStatus;
  onCheck: () => void;
  onInstall: () => void;
  onDismiss: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  if (status.kind === "idle") return null;

  const icon =
    status.kind === "checking" || status.kind === "installing" ? (
      <Loader2 size={14} className="rd-spin" aria-hidden="true" />
    ) : status.kind === "available" ? (
      <Download size={14} aria-hidden="true" />
    ) : status.kind === "latest" ? (
      <Check size={14} aria-hidden="true" />
    ) : status.kind === "check_failed" || status.kind === "install_failed" ? (
      <AlertTriangle size={14} aria-hidden="true" />
    ) : null;

  const message =
    status.kind === "available"
      ? t("updateAvailable", { version: status.version })
      : status.kind === "latest"
        ? t("update_latest")
        : status.kind === "not_configured"
          ? t("update_not_configured")
          : status.kind === "check_failed"
            ? t("update_check_failed")
            : status.kind === "install_failed"
              ? t("update_install_failed")
              : status.kind === "checking"
                ? t("checkingUpdate")
                : t("updating");

  const tone =
    status.kind === "check_failed" || status.kind === "install_failed"
      ? "error"
      : status.kind === "available"
        ? "info"
        : status.kind === "latest"
          ? "success"
          : "neutral";

  const primaryAction =
    status.kind === "available" ? (
      <Action primary onClick={onInstall}>
        <Download size={14} />
        {t("updateAndRestart")}
      </Action>
    ) : status.kind === "check_failed" ? (
      <Action onClick={onCheck}>
        <RefreshCw size={14} />
        {t("updateRetry")}
      </Action>
    ) : status.kind === "install_failed" ? (
      <Action onClick={onOpenSettings}>{t("settings")}</Action>
    ) : null;

  return (
    <div
      className={`rd-update-banner rd-update-banner--${tone}`}
      role="status"
      aria-live="polite"
    >
      <span className="rd-update-banner__message">
        {icon}
        {message}
      </span>
      <div className="rd-update-banner__actions">
        {primaryAction}
        {status.kind !== "installing" && (
          <button
            type="button"
            className="rd-update-banner__dismiss"
            onClick={onDismiss}
            aria-label={t("updateDismiss")}
          >
            <X size={14} aria-hidden="true" />
            <span>{t("updateDismiss")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
