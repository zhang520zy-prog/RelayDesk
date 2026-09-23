import { useEffect, useRef, useState } from "react";
import { CircleHelp, Loader2, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  relayApi,
  type RelayRestartCapability,
  type RelayRestartProgress,
  type RelayRestartResult,
  type RelayRestartStage,
  type RelayTarget,
} from "@/lib/api/relay";
import { type ApplyReport, targetLabels } from "../state/useRelayApply";
import { Action } from "../ui";
import "./restart.css";

/** 本次请求真实成功的目标（retained 的旧成功不算）。 */
function succeededTargets(
  report: ApplyReport | null,
  pending: boolean,
): RelayTarget[] {
  if (pending || !report) return [];
  return (report.launchTargets ?? report.targets).filter(
    (app) =>
      report.targets.includes(app) &&
      report.results.some((r) => r.app === app && r.ok),
  );
}

function restartErrorKey(error: unknown): string {
  const text = String(error);
  if (text.includes("relay.restart_expired")) return "restartErrExpired";
  if (text.includes("relay.restart_busy")) return "restartErrBusy";
  return "restartErrGeneric";
}

const RESTART_STAGES: RelayRestartStage[] = [
  "checking",
  "requesting_exit",
  "waiting_for_exit",
  "starting",
];

export function RestartToolsAction({
  report,
  pending,
  openDeployment,
}: {
  report: ApplyReport | null;
  pending: boolean;
  openDeployment: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const [executeOpen, setExecuteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<
    RelayRestartCapability[] | null
  >(null);
  const [capsFailed, setCapsFailed] = useState(false);
  const succeeded = succeededTargets(report, pending);

  // 本次确有成功目标时才查询真实重启能力；IPC 失败与“不支持”分开表示。
  useEffect(() => {
    let cancelled = false;
    if (pending || !report?.operationId || succeeded.length === 0) {
      setCapabilities(null);
      setCapsFailed(false);
      return;
    }
    setCapabilities(null);
    setCapsFailed(false);
    relayApi
      .getRestartCapabilities()
      .then((caps) => {
        if (!cancelled) setCapabilities(caps);
      })
      .catch(() => {
        if (!cancelled) setCapsFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.operationId, pending]);

  const restartable = succeeded.some(
    (app) => capabilities?.find((cap) => cap.app === app)?.supported,
  );
  const desktopTargets = succeeded.flatMap((app) => {
    const capability = capabilities?.find((cap) => cap.app === app);
    if (
      !capability?.supported ||
      !capability.targetId ||
      capability.targetKind !== "desktop"
    ) {
      return [];
    }
    return [capability.displayName ?? targetLabels[app]];
  });

  // 主按钮是唯一执行入口，按真实状态启用：
  // 应用中 → 禁用；无成功 → 禁用；检测中 → 禁用；检测失败 → 禁用且如实标注；
  // 无可重启目标 → 禁用；有可重启目标 → 启用进入确认流程。
  const mainState = pending
    ? "applying"
    : succeeded.length === 0
      ? "no_success"
      : capsFailed
        ? "caps_failed"
        : capabilities === null
          ? "checking"
          : restartable
            ? "ready"
            : "manual_only";

  const mainText =
    mainState === "applying"
      ? t("restartApplyingBtn")
      : mainState === "checking"
        ? t("restartCapsLoading")
        : t("restartTools");
  const mainTitle = {
    no_success: t("restartNeedApply"),
    manual_only: t("restartManualOnly"),
    caps_failed: t("restartCapsFailed"),
    applying: t("restartApplyingBtn"),
    checking: t("restartCapsLoading"),
    ready: t("restartTools"),
  }[mainState];

  return (
    <>
      <div className="rd-restart-entry">
        <Action
          disabled={mainState !== "ready"}
          className={mainState === "ready" ? undefined : "rd-restart-reserved"}
          aria-label={mainText}
          title={mainTitle}
          onClick={() => setExecuteOpen(true)}
        >
          {mainState === "checking" || mainState === "applying" ? (
            <Loader2 size={16} className="rd-spin" />
          ) : (
            <RotateCw size={16} />
          )}
          {mainText}
          {mainState === "caps_failed" && (
            <span className="rd-restart-badge">{t("restartCapsFailed")}</span>
          )}
        </Action>
        {desktopTargets.length > 0 && (
          <span
            className="rd-restart-target-summary"
            role="status"
            aria-label={t("restartTargetsSummary")}
          >
            <span className="rd-restart-target-summary-label">
              {t("restartTargetsLabel")}
            </span>
            {desktopTargets.map((target) => (
              <span className="rd-restart-target-chip" key={target}>
                {target}
              </span>
            ))}
          </span>
        )}
        <Action
          aria-label={t("restartGuide")}
          title={t("restartGuide")}
          onClick={() => setHelpOpen(true)}
        >
          <CircleHelp size={16} />
        </Action>
      </div>
      {executeOpen && (
        <RestartExecuteDialog
          key={report?.operationId ?? "no-operation"}
          report={report}
          pending={pending}
          onClose={() => setExecuteOpen(false)}
          openDeployment={() => {
            setExecuteOpen(false);
            openDeployment();
          }}
        />
      )}
      {helpOpen && (
        <RestartHelpDialog
          onClose={() => setHelpOpen(false)}
          openDeployment={() => {
            setHelpOpen(false);
            openDeployment();
          }}
        />
      )}
    </>
  );
}

type RestartPhase = "list" | "confirm" | "running" | "done";

function RestartExecuteDialog({
  report,
  pending,
  onClose,
  openDeployment,
}: {
  report: ApplyReport | null;
  pending: boolean;
  onClose: () => void;
  openDeployment: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const succeeded = succeededTargets(report, pending);
  const operationId = report?.operationId;
  const [tool, setTool] = useState<RelayTarget | null>(null);
  const [capabilities, setCapabilities] = useState<
    RelayRestartCapability[] | null
  >(null);
  const [phase, setPhase] = useState<RestartPhase>("list");
  const [stage, setStage] = useState<RelayRestartStage>("checking");
  const [result, setResult] = useState<RelayRestartResult | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const activeRestart = useRef<{
    operationId: string;
    app: RelayTarget;
  } | null>(null);

  // 每次进入目标列表都重新读取真实能力。启动/重启返回列表时，
  // 进程状态可能已经变化，不能沿用打开对话框时的快照。
  useEffect(() => {
    if (phase !== "list") return;
    let cancelled = false;
    setCapabilities(null);
    relayApi
      .getRestartCapabilities()
      .then((caps) => {
        if (!cancelled) setCapabilities(caps);
      })
      .catch(() => {
        if (!cancelled) setCapabilities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [phase]);

  // 进度事件只认当前重启操作的 operationId + app；旧请求事件一律忽略。
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void listen<RelayRestartProgress>(
      "relay-restart-progress",
      ({ payload }) => {
        const active = activeRestart.current;
        if (
          !active ||
          payload.operationId !== active.operationId ||
          payload.app !== active.app ||
          payload.stage === "done" ||
          payload.stage === "failed"
        ) {
          return;
        }
        setStage(payload.stage);
      },
    ).then((release) => {
      if (disposed) release();
      else unlisten = release;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const capability = tool
    ? capabilities?.find((cap) => cap.app === tool)
    : undefined;
  const displayName = capability?.displayName ?? (tool && targetLabels[tool]);

  async function confirmRestart() {
    const targetId = capability?.targetId;
    if (!tool || !targetId || !operationId || !succeeded.includes(tool)) return;
    activeRestart.current = { operationId, app: tool };
    setStage("checking");
    setResult(null);
    setInvokeError(null);
    setPhase("running");
    try {
      const outcome = await relayApi.restartTarget(tool, targetId, operationId);
      setResult(outcome);
    } catch (error) {
      setInvokeError(restartErrorKey(error));
    } finally {
      activeRestart.current = null;
      setPhase("done");
    }
  }

  const succeededLabel = succeeded.map((app) => targetLabels[app]).join(" · ");

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && phase !== "running") onClose();
      }}
    >
      <DialogContent className="rd-dialog rd-restart-dialog">
        <DialogTitle>{t("restartTools")}</DialogTitle>
        <DialogDescription className="rd-restart-description">
          {capabilities === null
            ? t("restartCheckingCaps")
            : t("restartAvailableDesc")}
        </DialogDescription>

        {phase === "list" && (
          <div className="rd-restart-body">
            <p className="rd-alert warning" role="status">
              {t("restartAppliedTargets", { targets: succeededLabel })}
            </p>
            <p className="rd-restart-hint">{t("restartAppliedSeparate")}</p>
            <ul className="rd-restart-targets">
              {succeeded.map((app) => {
                const cap = capabilities?.find((item) => item.app === app);
                const supported = Boolean(cap?.supported && cap?.targetId);
                const name = cap?.displayName ?? targetLabels[app];
                return (
                  <li key={app} className="rd-restart-target">
                    <div>
                      <strong>{name}</strong>
                      <span className="rd-restart-target-state">
                        {capabilities === null
                          ? t("restartCapsLoading")
                          : supported
                            ? t("restartReadyTarget", {
                                target: name,
                                state: t(
                                  cap?.running
                                    ? "restartStateRunning"
                                    : "restartStateStopped",
                                ),
                              })
                            : t(
                                `restartReason_${cap?.reason ?? "unsupported"}`,
                              )}
                      </span>
                    </div>
                    {supported && (
                      <Action
                        primary
                        onClick={() => {
                          setTool(app);
                          setResult(null);
                          setInvokeError(null);
                          setPhase("confirm");
                        }}
                      >
                        <RotateCw size={15} />
                        {cap?.running
                          ? t("restartTarget", { target: name })
                          : t("restartStartAction", { target: name })}
                      </Action>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {phase === "confirm" && tool && (
          <div className="rd-restart-body">
            <p className="rd-alert warning" role="status">
              {t(
                capability?.running === false
                  ? "restartConfirmStartTitle"
                  : "restartConfirmTitle",
                { target: displayName },
              )}
            </p>
            <p className="rd-restart-hint">
              {t(
                capability?.running
                  ? "restartConfirmRunning"
                  : "restartConfirmStopped",
                { target: displayName },
              )}
            </p>
            {capability?.running && (
              <p className="rd-restart-hint">{t("restartConfirmRisk")}</p>
            )}
            {tool === "claude" && (
              <p className="rd-restart-hint">{t("restartClaudeDistinction")}</p>
            )}
          </div>
        )}

        {phase === "running" && (
          <div className="rd-restart-body">
            <ol className="rd-restart-progress" role="status">
              {RESTART_STAGES.map((item) => (
                <li
                  key={item}
                  className={item === stage ? "is-active" : ""}
                  aria-current={item === stage ? "step" : undefined}
                >
                  {item === stage && <Loader2 size={13} className="rd-spin" />}
                  {t(`restartStage_${item}`)}
                </li>
              ))}
            </ol>
          </div>
        )}

        {phase === "done" && (
          <div className="rd-restart-body">
            {result &&
            (result.status === "restarted" ||
              result.status === "not_running_started") ? (
              <p className="rd-alert success" role="status">
                {t(`restartResult_${result.status}`, { target: displayName })}
              </p>
            ) : (
              <p className="rd-alert error" role="alert">
                {result
                  ? t(`restartResult_${result.status}`, { target: displayName })
                  : t(invokeError ?? "restartErrGeneric")}{" "}
                {t("restartFailedKeepsApply")}
              </p>
            )}
          </div>
        )}

        <footer className="rd-restart-footer">
          {phase === "confirm" && (
            <>
              <Action primary onClick={() => void confirmRestart()}>
                {t(
                  capability?.running === false
                    ? "restartStartAction"
                    : "restartConfirmAction",
                  { target: displayName },
                )}
              </Action>
              <Action onClick={() => setPhase("list")}>
                {t("restartCancelConfirm")}
              </Action>
            </>
          )}
          {phase === "running" && (
            <Action disabled>
              <Loader2 size={15} className="rd-spin" />
              {t("restartRunning")}
            </Action>
          )}
          {phase === "done" && (
            <Action onClick={() => setPhase("list")}>
              {t("restartBackToList")}
            </Action>
          )}
          <div className="rd-restart-footer-actions">
            {phase === "list" && (
              <Action onClick={openDeployment}>{t("openEnvironment")}</Action>
            )}
            <Action
              primary={phase !== "confirm"}
              onClick={onClose}
              disabled={phase === "running"}
            >
              {t("close")}
            </Action>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

/** 纯帮助说明：不查询能力、不调用重启、不含任何执行动作。 */
function RestartHelpDialog({
  onClose,
  openDeployment,
}: {
  onClose: () => void;
  openDeployment: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="rd-dialog rd-restart-dialog">
        <DialogTitle>{t("restartHelpTitle")}</DialogTitle>
        <DialogDescription className="rd-restart-description">
          {t("restartHelpScope")}
        </DialogDescription>
        <div className="rd-restart-body">
          <p className="rd-restart-hint">{t("restartHelpSupported")}</p>
          <p className="rd-restart-hint">{t("restartClaudeDistinction")}</p>
          <p className="rd-restart-hint">{t("restartHelpEntry")}</p>
          <h3 className="rd-restart-subtitle">{t("restartHelpManualTitle")}</h3>
          <p className="rd-restart-hint">{t("restartSaveWork")}</p>
          {(
            [
              ["codex", "ChatGPT / Codex"],
              ["claude", "Claude Code CLI"],
              ["claudeDesktop", "Claude.app"],
              ["gemini", "Gemini CLI"],
            ] as const
          ).map(([tool, title]) => (
            <section className="rd-restart-manual-section" key={tool}>
              <h4 className="rd-restart-subtitle">{title}</h4>
              <ol className="rd-restart-steps">
                <li>{t(`restartExit_${tool}`)}</li>
                <li>{t(`restartReopen_${tool}`)}</li>
              </ol>
            </section>
          ))}
          <p className="rd-restart-hint">{t("restartScope")}</p>
        </div>
        <footer className="rd-restart-footer">
          <div className="rd-restart-footer-actions">
            <Action onClick={openDeployment}>{t("openEnvironment")}</Action>
            <Action primary onClick={onClose}>
              {t("close")}
            </Action>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
