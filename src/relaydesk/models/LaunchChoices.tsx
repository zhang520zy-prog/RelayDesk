import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Download,
  Loader2,
  Monitor,
  RefreshCw,
  TerminalSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  relayApi,
  type RelayTarget,
  type RelayTargetInstall,
} from "@/lib/api/relay";
import { Action } from "../ui";
import { targetLabels } from "../state/useRelayApply";
import { InstallToolDialog } from "../environment/InstallToolDialog";
import { ToolInstallGuide } from "../environment/ToolInstallGuide";
import { canLaunchDesktop, getRuntimePlatform } from "../environment/platform";
import "./launch.css";

type Detection =
  | { phase: "checking" }
  | { phase: "failed" }
  | { phase: "ready"; installations: RelayTargetInstall[] };

export function LaunchChoices({
  targets,
  busy,
  onDismiss,
  openEnvironment,
}: {
  targets: RelayTarget[];
  busy: boolean;
  onDismiss: () => void;
  openEnvironment?: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const [detection, setDetection] = useState<Detection>({ phase: "checking" });
  const [launchBusy, setLaunchBusy] = useState<string | null>(null);
  const [launchResults, setLaunchResults] = useState<
    Partial<Record<RelayTarget, "failed" | "sent">>
  >({});
  const [installApp, setInstallApp] = useState<RelayTarget | null>(null);
  const [guide, setGuide] = useState<RelayTarget | null>(null);
  const mounted = useRef(false);
  const detectRequest = useRef(0);
  const launching = useRef(false);
  const desktopAllowed = canLaunchDesktop(getRuntimePlatform());

  const detect = useCallback(async () => {
    const request = ++detectRequest.current;
    setDetection({ phase: "checking" });
    try {
      const installations = await relayApi.detectTargetInstallations();
      if (mounted.current && request === detectRequest.current)
        setDetection({ phase: "ready", installations });
    } catch {
      if (mounted.current && request === detectRequest.current)
        setDetection({ phase: "failed" });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void detect();
    return () => {
      mounted.current = false;
      detectRequest.current += 1;
    };
  }, [detect]);

  async function launch(app: RelayTarget, mode: "desktop" | "cli") {
    if (busy || launching.current || installApp) return;
    launching.current = true;
    setLaunchBusy(`${app}:${mode}`);
    setLaunchResults((old) => ({ ...old, [app]: undefined }));
    try {
      await relayApi.launchTarget(app, mode);
      if (mounted.current)
        setLaunchResults((old) => ({ ...old, [app]: "sent" }));
    } catch {
      if (mounted.current)
        setLaunchResults((old) => ({ ...old, [app]: "failed" }));
    } finally {
      launching.current = false;
      if (mounted.current) setLaunchBusy(null);
    }
  }

  const installations =
    detection.phase === "ready" ? detection.installations : [];
  const allMissing =
    detection.phase === "ready" &&
    targets.every((app) => {
      const installed = installations.find((item) => item.app === app);
      return (
        installed &&
        !installed.cliPath &&
        !(desktopAllowed && installed.desktopApp)
      );
    });
  const disabled = busy || launchBusy !== null || installApp !== null;

  return (
    <section className="rd-launch-choices" aria-label={t("launchNextTitle")}>
      <p className="rd-launch-overline">{t("launchNextTitle")}</p>
      <h3>{t("launchQuestion")}</h3>
      <p className="rd-launch-hint">{t("launchAppliedHint")}</p>
      {targets.map((app) => {
        const installed = installations.find((item) => item.app === app);
        const hasDesktop = desktopAllowed && Boolean(installed?.desktopApp);
        const hasCli = Boolean(installed?.cliPath);
        const unknown =
          detection.phase === "failed" ||
          (detection.phase === "ready" && !installed);
        return (
          <div
            className="rd-launch-choice"
            role="group"
            aria-label={t("launchOptionsFor", { target: targetLabels[app] })}
            key={app}
          >
            <strong>{targetLabels[app]}</strong>
            {detection.phase === "checking" ? (
              <p className="rd-launch-state" role="status">
                <Loader2 size={15} className="rd-spin" />
                {t("launchChecking")}
              </p>
            ) : unknown ? (
              <div className="rd-launch-unknown">
                <p className="rd-launch-state" role="status">
                  <AlertCircle size={15} />
                  {t("launchDetectFailed")}
                </p>
                <Action disabled={disabled} onClick={() => void detect()}>
                  <RefreshCw size={14} />
                  {t("launchDetectRetry")}
                </Action>
              </div>
            ) : (
              <>
                <div className="rd-launch-choice-actions">
                  {hasDesktop && (
                    <Action
                      primary
                      disabled={disabled}
                      onClick={() => void launch(app, "desktop")}
                    >
                      {launchBusy === `${app}:desktop` ? (
                        <Loader2 size={14} className="rd-spin" />
                      ) : (
                        <Monitor size={14} />
                      )}
                      {installed?.desktopName
                        ? t("launchDesktopNamed", { name: installed.desktopName })
                        : t("launchDesktop")}
                    </Action>
                  )}
                  {hasCli && (
                    <Action
                      primary={!hasDesktop}
                      disabled={disabled}
                      onClick={() => void launch(app, "cli")}
                    >
                      {launchBusy === `${app}:cli` ? (
                        <Loader2 size={14} className="rd-spin" />
                      ) : (
                        <TerminalSquare size={14} />
                      )}
                      {t(hasDesktop ? "launchCli" : "launchTerminal")}
                    </Action>
                  )}
                  {!hasDesktop && !hasCli && (
                    <>
                      <span className="rd-launch-missing">
                        {t(
                          installed?.desktopApp
                            ? "launchDesktopUnavailable"
                            : "notInstalled",
                        )}
                      </span>
                      <Action
                        primary
                        disabled={disabled}
                        onClick={() => setInstallApp(app)}
                      >
                        <Download size={14} />
                        {t("launchInstallCli")}
                      </Action>
                    </>
                  )}
                  {!hasDesktop && (
                    <button
                      type="button"
                      className="rd-text-button"
                      aria-expanded={guide === app}
                      onClick={() => setGuide(guide === app ? null : app)}
                    >
                      {t(guide === app ? "launchHideGuide" : "launchShowGuide")}
                    </button>
                  )}
                </div>
                {hasDesktop && installed?.desktopReadsCliConfig === false && (
                  <p className="rd-alert warning rd-launch-feedback">
                    {t("launchDesktopConfigWarning", {
                      name: installed.desktopName ?? t("launchDesktop"),
                      target: targetLabels[app],
                    })}
                  </p>
                )}
                {guide === app && <ToolInstallGuide app={app} />}
              </>
            )}
            {launchResults[app] === "failed" && (
              <p className="rd-alert error rd-launch-feedback" role="alert">
                {t("launchFailed")}
              </p>
            )}
            {launchResults[app] === "sent" && (
              <p className="rd-launch-state rd-success-text" role="status">
                <Check size={14} />
                {t("launchStarted")}
              </p>
            )}
          </div>
        );
      })}
      <div className="rd-launch-choice-footer">
        {openEnvironment && (
          <button
            type="button"
            className="rd-text-button"
            disabled={disabled}
            onClick={() => {
              onDismiss();
              openEnvironment();
            }}
          >
            {t("launchEnvironment")}
          </button>
        )}
        <Action onClick={onDismiss}>
          {t(allMissing ? "launchCancel" : "launchLater")}
        </Action>
      </div>
      <InstallToolDialog
        app={installApp}
        onClose={() => setInstallApp(null)}
        onInstalled={async () => {
          setInstallApp(null);
          await detect();
        }}
      />
    </section>
  );
}
