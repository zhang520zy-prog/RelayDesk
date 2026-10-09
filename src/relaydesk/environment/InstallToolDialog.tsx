import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { settingsApi } from "@/lib/api/settings";
import { relayApi, type RelayTarget } from "@/lib/api/relay";
import { targetLabels } from "../state/useRelayApply";
import { Action } from "../ui";
import { ToolInstallGuide } from "./ToolInstallGuide";
import "./environment.css";

export function InstallToolDialog({
  app,
  repair,
  onClose,
  onInstalled,
}: {
  app: RelayTarget | null;
  /** 已安装但无法运行时以"修复"语境呈现，避免用户以为是全新安装 */
  repair?: boolean;
  onClose: () => void;
  onInstalled: () => void | Promise<void>;
}) {
  // Separate instances reset errors between confirmations without retaining old actions.
  return app ? (
    <InstallConfirmation
      key={`${app}-${repair ? "repair" : "install"}`}
      app={app}
      repair={repair}
      onClose={onClose}
      onInstalled={onInstalled}
    />
  ) : null;
}

function InstallConfirmation({
  app,
  repair,
  onClose,
  onInstalled,
}: {
  app: RelayTarget;
  repair?: boolean;
  onClose: () => void;
  onInstalled: () => void | Promise<void>;
}) {
  const { t } = useTranslation("relaydesk");
  const client = useQueryClient();
  const locked = useRef(false);
  const [recheckFailed, setRecheckFailed] = useState(false);
  const plan = useQuery({
    queryKey: ["relaydesk", "tool-install-plan", app],
    queryFn: () => relayApi.getToolInstallPlan(app),
    retry: false,
    staleTime: 24 * 60 * 60 * 1000,
  });
  const installation = useMutation({
    mutationKey: ["relaydesk", "tool-install"],
    mutationFn: () => settingsApi.runToolLifecycleAction([app], "install"),
  });
  async function confirm() {
    if (locked.current || !plan.data) return;
    locked.current = true;
    try {
      await installation.mutateAsync();
      // The launch dialog and Settings share findings. Refresh on the next visit
      // after an explicit install, while ordinary navigation keeps cached checks.
      await client.invalidateQueries({
        queryKey: ["relaydesk", "environment"],
        refetchType: "none",
      });
      // Installation succeeded even if the subsequent check is unavailable.
      try {
        await onInstalled();
        onClose();
      } catch {
        setRecheckFailed(true);
      }
    } catch {
      // Never render raw lifecycle output: it can contain paths or credentials.
    } finally {
      locked.current = false;
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !locked.current) onClose();
      }}
    >
      <DialogContent
        className="rd-dialog rd-install-dialog"
        onEscapeKeyDown={(e) => {
          if (locked.current) e.preventDefault();
        }}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogTitle>
          {t(repair ? "confirmToolRepair" : "confirmToolInstall", {
            tool: targetLabels[app],
          })}
        </DialogTitle>
        <DialogDescription>
          {t(repair ? "repairConfirmationHint" : "installConfirmationHint")}
        </DialogDescription>
        {plan.isPending ? (
          <p role="status" className="rd-env-inline">
            <Loader2 size={16} className="rd-spin" />
            {t("installPlanLoading")}
          </p>
        ) : plan.isError || !plan.data ? (
          <p role="alert" className="rd-alert error">
            {t("installPlanFailed")}
          </p>
        ) : (
          <dl className="rd-install-summary">
            <dt>{t("installationSource")}</dt>
            <dd>{plan.data.source}</dd>
            <dt>{t("installCommand")}</dt>
            <dd>
              <code>{plan.data.command}</code>
            </dd>
            <dt>{t("installLocations")}</dt>
            <dd>
              {t(
                app === "claude"
                  ? "claudeInstallLocations"
                  : "npmInstallLocations",
              )}
            </dd>
          </dl>
        )}
        {app === "claude" && (
          <p className="rd-alert warning">{t("claudeInstallFallback")}</p>
        )}
        <p className="rd-muted rd-small">{t("installEnvironmentHint")}</p>
        {installation.isPending && (
          <p role="status" className="rd-env-inline">
            <Loader2 size={16} className="rd-spin" />
            {t("installingTool", { tool: targetLabels[app] })}
          </p>
        )}
        {installation.isError && (
          <>
            <p role="alert" className="rd-alert error">
              {t("installFailedSafe")}
            </p>
            <ToolInstallGuide app={app} />
          </>
        )}
        {recheckFailed && <p role="status">{t("installedRecheckFailed")}</p>}
        <div className="rd-env-actions rd-install-footer">
          {!installation.isPending && (
            <Action onClick={onClose}>{t("cancel")}</Action>
          )}
          {!installation.isSuccess && (
            <Action
              primary
              disabled={installation.isPending || !plan.data}
              onClick={() => void confirm()}
            >
              <Download size={15} />
              {t(
                installation.isPending
                  ? "installing"
                  : repair
                    ? "envToolRepair"
                    : "confirmInstall",
              )}
            </Action>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
