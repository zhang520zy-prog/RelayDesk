import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { settingsApi } from "@/lib/api/settings";
import { relayApi, type RelayAccountInfo } from "@/lib/api/relay";
import {
  deployOnlyIds,
  deployOnlyLabels,
  targetIds,
  targetLabels,
} from "../state/useRelayApply";

const detectIds = [...targetIds, ...deployOnlyIds] as string[];
const allLabels: Record<string, string> = {
  ...targetLabels,
  ...deployOnlyLabels,
};
import { Action } from "../ui";
import "./onboarding.css";

const DISMISS_KEY = "relaydesk.onboarding.dismissed";

function persistDismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // ignore
  }
}

type Step = "detect" | "sync" | "done";

/**
 * 首登主动引导：打开即自动检测本机工具与基础环境，
 * 缺失项就地一键补装，随后选择同步目标并直接进入模型中心。
 * 老用户随时可跳过（localStorage 持久化）。
 */
export function OnboardingWizard({
  account,
  open,
  setApps,
  onFinish,
}: {
  account: RelayAccountInfo;
  open: boolean;
  setApps: (apps: typeof account.applyApps) => Promise<void>;
  onFinish: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const client = useQueryClient();
  const [step, setStep] = useState<Step>("detect");
  const [installing, setInstalling] = useState<string | null>(null);
  const [draft, setDraft] = useState(account.applyApps);

  const installations = useQuery({
    queryKey: ["relaydesk", "environment", "installations"],
    queryFn: relayApi.detectTargetInstallations,
    enabled: open,
    retry: false,
  });
  const env = useQuery({
    queryKey: ["relaydesk", "environment", "checks"],
    queryFn: relayApi.envCheck,
    enabled: open,
    retry: false,
  });
  const refreshAll = () =>
    Promise.all([
      client.invalidateQueries({
        queryKey: ["relaydesk", "environment", "installations"],
      }),
      client.invalidateQueries({
        queryKey: ["relaydesk", "environment", "checks"],
      }),
    ]);

  const installTool = useMutation({
    mutationFn: (app: string) =>
      settingsApi.runToolLifecycleAction([app], "install"),
    onMutate: (app) => setInstalling(app),
    onSettled: () => setInstalling(null),
    onSuccess: async () => {
      await refreshAll();
      toast.success(t("onboardInstallOk"));
    },
    onError: () => toast.error(t("onboardInstallFailed")),
  });

  const missingEnv = (env.data ?? []).filter(
    (c) =>
      ["git", "python", "node"].includes(c.id) &&
      c.status !== "ok" &&
      c.status !== "unavailable",
  );
  const envFix = useMutation({
    mutationFn: (id: string) => relayApi.envFix(id),
    onMutate: (id) => setInstalling(`env:${id}`),
    onSettled: () => setInstalling(null),
    onSuccess: async () => {
      await refreshAll();
      toast.success(t("onboardInstallOk"));
    },
    onError: () => toast.error(t("onboardInstallFailed")),
  });

  const installedCount = detectIds.filter((id) => {
    const item = installations.data?.find((i) => i.app === id);
    return item && (item.cliPath || item.desktopApp);
  }).length;
  const detecting = installations.isPending || env.isPending;

  const finish = async (skip = false) => {
    // setApps 内部已处理错误提示；跳过时不写目标设置
    if (!skip) await setApps(draft);
    persistDismiss();
    onFinish();
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="rd-dialog rd-onboarding-wizard"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="rd-ow-head">
          <div>
            <DialogTitle>{t("onboardWizardTitle")}</DialogTitle>
            <DialogDescription>{t("onboardWizardHint")}</DialogDescription>
          </div>
          <div className="rd-ow-steps" aria-hidden="true">
            {(["detect", "sync", "done"] as const).map((s, i) => (
              <span
                key={s}
                className={`rd-ow-dot ${step === s ? "is-active" : ""} ${
                  (s === "sync" && step === "done") ||
                  (s === "detect" && step !== "detect")
                    ? "is-done"
                    : ""
                }`}
              >
                {i + 1}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="rd-onboarding-skip"
            aria-label={t("onboardingSkip")}
            onClick={() => void finish(true)}
          >
            <X size={14} aria-hidden="true" />
            {t("onboardingSkip")}
          </button>
        </div>

        {step === "detect" && (
          <div className="rd-ow-body">
            <p className="rd-muted rd-small">{t("onboardDetectHint")}</p>
            <ul className="rd-ow-list">
              {detectIds.map((id) => {
                const item = installations.data?.find((i) => i.app === id);
                const installed = !!(item?.cliPath || item?.desktopApp);
                return (
                  <li key={id} className="rd-ow-row">
                    <strong>{allLabels[id] ?? id}</strong>
                    {detecting ? (
                      <Loader2 size={14} className="rd-spin" />
                    ) : installed ? (
                      <span className="rd-success-text">
                        <Check size={13} /> {t("onboardInstalled")}
                      </span>
                    ) : (
                      <Action
                        onClick={() => installTool.mutate(id)}
                        disabled={installing != null}
                      >
                        {installing === id ? (
                          <Loader2 size={13} className="rd-spin" />
                        ) : null}
                        {t("onboardInstall")}
                      </Action>
                    )}
                  </li>
                );
              })}
              {missingEnv.map((c) => (
                <li key={c.id} className="rd-ow-row rd-ow-env">
                  <strong>{c.id}</strong>
                  <span className="rd-muted">{t("onboardEnvMissing")}</span>
                  <Action
                    onClick={() => envFix.mutate(c.id)}
                    disabled={installing != null}
                  >
                    {installing === `env:${c.id}` ? (
                      <Loader2 size={13} className="rd-spin" />
                    ) : null}
                    {t("onboardAutoFix")}
                  </Action>
                </li>
              ))}
            </ul>
            {!detecting && (
              <p className="rd-muted rd-small">
                {t("onboardDetectSummary", { count: installedCount })}
              </p>
            )}
            <div className="rd-ow-footer">
              <Action
                primary
                disabled={detecting}
                onClick={() => setStep("sync")}
              >
                {t("onboardNext")}
              </Action>
            </div>
          </div>
        )}

        {step === "sync" && (
          <div className="rd-ow-body">
            <p className="rd-muted rd-small">{t("onboardSyncHint")}</p>
            <ul className="rd-ow-list">
              {targetIds.map((id) => (
                <li key={id} className="rd-ow-row">
                  <strong>{targetLabels[id]}</strong>
                  <Switch
                    aria-label={targetLabels[id]}
                    checked={draft[id]}
                    onCheckedChange={(v) =>
                      setDraft((d) => ({ ...d, [id]: v }))
                    }
                  />
                </li>
              ))}
            </ul>
            <div className="rd-ow-footer">
              <Action onClick={() => setStep("detect")}>{t("back")}</Action>
              <Action primary onClick={() => setStep("done")}>
                {t("onboardNext")}
              </Action>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="rd-ow-body rd-ow-done">
            <Check size={28} className="rd-ow-done-icon" />
            <p>{t("onboardDoneTitle")}</p>
            <p className="rd-muted rd-small">{t("onboardDoneHint")}</p>
            <div className="rd-ow-footer">
              <Action onClick={() => setStep("sync")}>{t("back")}</Action>
              <Action primary onClick={() => void finish(false)}>
                {t("onboardEnterModels")}
              </Action>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
