import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Loader2, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { settingsApi } from "@/lib/api/settings";
import { relayApi } from "@/lib/api/relay";
import { Action } from "../ui";
import "./environment.css";

export function EnvFixDialog({
  check,
  onClose,
  onDone,
}: {
  check: { id: string; label: string } | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  // Separate instances reset errors between confirmations without retaining old actions.
  return check ? (
    <EnvFixConfirmation
      key={check.id}
      check={check}
      onClose={onClose}
      onDone={onDone}
    />
  ) : null;
}

function EnvFixConfirmation({
  check,
  onClose,
  onDone,
}: {
  check: { id: string; label: string };
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { t } = useTranslation("relaydesk");
  const client = useQueryClient();
  const locked = useRef(false);
  const [status, setStatus] = useState<string | null>(null);
  const plan = useQuery({
    queryKey: ["relaydesk", "env-fix-plan", check.id],
    queryFn: () => relayApi.envFixPlan(check.id),
    retry: false,
    staleTime: 60 * 1000,
  });
  const fix = useMutation({
    mutationKey: ["relaydesk", "env-fix"],
    mutationFn: () => relayApi.envFix(check.id),
  });
  async function confirm() {
    if (locked.current || !plan.data?.supported) return;
    locked.current = true;
    try {
      await fix.mutateAsync();
      await client.invalidateQueries({
        queryKey: ["relaydesk", "environment"],
        refetchType: "none",
      });
      try {
        await onDone();
      } finally {
        onClose();
      }
    } catch {
      // Never render raw installer output: it can contain paths or credentials.
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
        <DialogTitle>{t("envFixTitle", { name: check.label })}</DialogTitle>
        <DialogDescription>{t("installConfirmationHint")}</DialogDescription>
        {plan.isPending ? (
          <p role="status" className="rd-env-inline">
            <Loader2 size={16} className="rd-spin" />
            {t("installPlanLoading")}
          </p>
        ) : plan.isError || !plan.data ? (
          <p role="alert" className="rd-alert error">
            {t("installPlanFailed")}
          </p>
        ) : plan.data.supported && plan.data.command ? (
          <dl className="rd-install-summary">
            <dt>{t("installationSource")}</dt>
            <dd>{plan.data.source}</dd>
            <dt>{t("installCommand")}</dt>
            <dd>
              <code>{plan.data.command}</code>
            </dd>
          </dl>
        ) : (
          <p className="rd-alert warning">{t("envFixUnsupported")}</p>
        )}
        {plan.data?.supported && (
          <p className="rd-muted rd-small">{t("envFixHint")}</p>
        )}
        {plan.data?.docsUrl && (
          <div className="rd-env-actions">
            <Action
              onClick={() =>
                void settingsApi
                  .openExternal(plan.data!.docsUrl!)
                  .catch(() => setStatus("guideOpenFailed"))
              }
            >
              <ExternalLink size={14} />
              {t("officialInstallGuide")}
            </Action>
            {plan.data.command && (
              <Action
                onClick={() =>
                  void navigator.clipboard.writeText(plan.data!.command!).then(
                    () => setStatus("commandCopied"),
                    () => setStatus("commandCopyFailed"),
                  )
                }
              >
                <Copy size={14} />
                {t("copyCommand")}
              </Action>
            )}
          </div>
        )}
        {fix.isPending && (
          <p role="status" className="rd-env-inline">
            <Loader2 size={16} className="rd-spin" />
            {t("installingTool", { tool: check.label })}
          </p>
        )}
        {fix.isError && (
          <p role="alert" className="rd-alert error">
            {t("installFailedSafe")}
          </p>
        )}
        {status && <p role="status">{t(status)}</p>}
        <div className="rd-env-actions rd-install-footer">
          {!fix.isPending && <Action onClick={onClose}>{t("cancel")}</Action>}
          {!fix.isSuccess && plan.data?.supported && (
            <Action
              primary
              disabled={fix.isPending}
              onClick={() => void confirm()}
            >
              <Download size={15} />
              {t(fix.isPending ? "installing" : "confirmInstall")}
            </Action>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
