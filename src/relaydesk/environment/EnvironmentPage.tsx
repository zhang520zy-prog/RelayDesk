import { useState } from "react";
import { useQuery, useIsMutating } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  CircleHelp,
  AlertCircle,
  Loader2,
  RefreshCw,
  Download,
  MonitorX,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { relayApi, type RelayTarget } from "@/lib/api/relay";
import { settingsApi } from "@/lib/api/settings";
import { Action } from "../ui";
import { targetIds, targetLabels } from "../state/useRelayApply";
import { relayErrorKey } from "../state/relayErrors";
import { InstallToolDialog } from "./InstallToolDialog";
import { EnvFixDialog } from "./EnvFixDialog";
import { ToolInstallGuide } from "./ToolInstallGuide";
import { getRuntimePlatform, type EnvironmentPlatform } from "./platform";
import type { EnvironmentCheck } from "./environmentTypes";
import "./environment.css";

const statusIcons = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: AlertCircle,
  fixable: Download,
  loading: Loader2,
  unavailable: CircleHelp,
  unsupported: MonitorX,
};

export function EnvironmentCheckRow({
  check,
  children,
}: {
  check: EnvironmentCheck;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation("relaydesk");
  const Icon = statusIcons[check.status];
  return (
    <li className="rd-env-row" data-status={check.status}>
      <Icon
        size={18}
        aria-hidden
        className={check.status === "loading" ? "rd-spin" : ""}
      />
      <div className="rd-env-item">
        <strong>{check.label}</strong>
        <span>{check.detail}</span>
      </div>
      <span className={`rd-env-status ${check.status}`}>
        {t(`envStatus_${check.status}`)}
      </span>
      {children && <div className="rd-env-row-actions">{children}</div>}
    </li>
  );
}

export function EnvironmentPage({
  onBack,
  platform = getRuntimePlatform(),
  busy = false,
}: {
  onBack: () => void;
  platform?: EnvironmentPlatform;
  busy?: boolean;
}) {
  const { t } = useTranslation("relaydesk");
  const [install, setInstall] = useState<RelayTarget | null>(null);
  const [envFix, setEnvFix] = useState<{ id: string; label: string } | null>(
    null,
  );
  const [guide, setGuide] = useState<RelayTarget | null>(null);
  const [guidePlatform, setGuidePlatform] =
    useState<EnvironmentPlatform>(platform);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const installing =
    useIsMutating({ mutationKey: ["relaydesk", "tool-install"] }) > 0;
  const fixing = useIsMutating({ mutationKey: ["relaydesk", "env-fix"] }) > 0;
  const queryOptions = {
    retry: false as const,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  };
  const installations = useQuery({
    queryKey: ["relaydesk", "environment", "installations"],
    queryFn: relayApi.detectTargetInstallations,
    ...queryOptions,
  });
  const versions = useQuery({
    queryKey: ["relaydesk", "environment", "versions"],
    queryFn: () => settingsApi.getToolVersions(targetIds),
    ...queryOptions,
  });
  const doctor = useQuery({
    queryKey: ["relaydesk", "environment", "doctor"],
    queryFn: relayApi.envCheck,
    ...queryOptions,
  });
  const loading =
    installations.isFetching || versions.isFetching || doctor.isFetching;
  async function recheck() {
    await Promise.all([
      installations.refetch(),
      versions.refetch(),
      doctor.refetch(),
    ]);
  }
  async function exportLogs() {
    if (exporting) return;
    setExporting(true);
    setStatus(null);
    try {
      const destination = await settingsApi.saveFileDialog(
        "relaydesk-diagnostics.log",
      );
      if (destination) {
        await relayApi.exportDiagnostics(destination);
        setStatus("exported");
      }
    } catch (e) {
      setStatus(relayErrorKey(e));
    } finally {
      setExporting(false);
    }
  }
  function toolCheck(app: RelayTarget): EnvironmentCheck {
    const base = { id: `${app}-cli`, label: targetLabels[app] };
    if (loading)
      return { ...base, status: "loading", detail: t("envCheckingTool") };
    const found = installations.data?.find((item) => item.app === app);
    const version = versions.data?.find((item) => item.name === app);
    if (!versions.isError && version?.installed_but_broken)
      return { ...base, status: "warn", detail: t("envToolBroken") };
    if (!versions.isError && version?.version)
      return {
        ...base,
        status: "ok",
        detail: /^\d[\w.+() -]{0,50}$/.test(version.version)
          ? version.version
          : t("envCliRuns"),
      };
    if (installations.isError || !found)
      return { ...base, status: "error", detail: t("installationUnknown") };
    if (found.cliPath)
      return { ...base, status: "warn", detail: t("envRuntimeUnknown") };
    return { ...base, status: "fixable", detail: t("notInstalled") };
  }
  // 桌面端单独成行：与 CLI 的安装/配置状态互不混淆。
  // 仅在工具注册表提供桌面入口（desktopUrl 或已检测到）时渲染。
  function desktopCheck(app: RelayTarget): EnvironmentCheck | null {
    if (loading) return null;
    const found = installations.data?.find((item) => item.app === app);
    if (!found || !found.desktopCandidates?.length) return null;
    const rawName = found.desktopName ?? found.desktopCandidates[0];
    // 显示名可能已含 "desktop"（如 Claude desktop），剥掉再加本地化后缀，
    // 避免出现 "Claude desktop desktop" 这类重复。
    const label = t("desktopRowLabel", {
      name: rawName.replace(/\s+desktop\s*$/i, ""),
    });
    const base = { id: `${app}-desktop`, label };
    if (found.desktopApp)
      return {
        ...base,
        status: "ok",
        detail: t(
          found.desktopReadsCliConfig
            ? "envDesktopInstalledReads"
            : "envDesktopInstalledSeparate",
        ),
      };
    if (platform !== "macos")
      return {
        ...base,
        status: "unsupported",
        detail: t("envDesktopUnsupported"),
      };
    return {
      ...base,
      status: "warn",
      detail: t("envDesktopMissingOptional"),
    };
  }
  const systemCheckIds = [
    "git",
    "python",
    "node",
    "writable",
    // WebView2 只在 Windows 端有意义；诊断导出仍会包含其他平台的检查项。
    ...(platform === "windows" ? ["webview2"] : []),
  ];
  // 这几项缺失时后端可以给出自动安装方案；其余检查只提供指引。
  const envFixableIds = new Set(["git", "python", "node"]);
  const connectionCheckIds = ["relay", "proxy"];
  const checkLabels: Record<string, string> = {
    git: "Git",
    python: "Python",
    node: "Node.js / npm",
    writable: t("envConfigWritable"),
    relay: t("envRelayConnection"),
    proxy: t("envSystemProxy"),
    webview2: "WebView2 Runtime",
  };
  function envRow(id: string): EnvironmentCheck {
    const label = checkLabels[id];
    if (doctor.isPending)
      return { id, label, status: "loading", detail: t("envCheckingTool") };
    if (doctor.isError)
      return { id, label, status: "error", detail: t("envCheck_failed") };
    const check = doctor.data?.find((item) => item.id === id);
    if (!check)
      return { id, label, status: "error", detail: t("envCheck_failed") };
    const detail =
      check.detail ?? t(`envCheck_${id}_${check.reason ?? check.status}`);
    return { id, label, status: check.status, detail };
  }
  return (
    <div className="rd-environment">
      <div className="rd-env-heading">
        <div>
          <h2>
            <Download size={22} />
            {t("envAiTools")}
          </h2>
          <p>{t("deploymentHint")}</p>
        </div>
        <Action disabled={loading || installing} onClick={() => void recheck()}>
          <RefreshCw size={15} className={loading ? "rd-spin" : ""} />
          {t(loading ? "envCheckingTool" : "checkAgain")}
        </Action>
      </div>
      <section className="rd-setting-section rd-deployment-tools">
        <ul className="rd-env-list">
          {targetIds.flatMap((app) => {
            const check = toolCheck(app);
            const desktop = desktopCheck(app);
            const found = installations.data?.find((item) => item.app === app);
            return [
              <EnvironmentCheckRow key={check.id} check={check}>
                {check.status === "fixable" && (
                  <Action
                    disabled={installing || busy}
                    onClick={() => {
                      if (!busy && !installing) setInstall(app);
                    }}
                  >
                    {t("installCli")}
                  </Action>
                )}
                {check.status !== "loading" && (
                  <Action
                    aria-expanded={guide === app}
                    onClick={() => setGuide(guide === app ? null : app)}
                  >
                    {t("viewInstallGuide")}
                  </Action>
                )}
              </EnvironmentCheckRow>,
              ...(desktop
                ? [
                    <EnvironmentCheckRow key={desktop.id} check={desktop}>
                      {found?.desktopUrl &&
                        (desktop.status === "warn" ||
                          (desktop.status === "unsupported" &&
                            platform === "windows")) && (
                          <Action
                            onClick={() =>
                              void relayApi
                                .openDesktopDownload(app)
                                .catch((e) => setStatus(relayErrorKey(e)))
                            }
                          >
                            {t("downloadDesktop")}
                          </Action>
                        )}
                    </EnvironmentCheckRow>,
                  ]
                : []),
            ];
          })}
        </ul>
        {guide && (
          <div className="rd-env-tool-guide">
            <h4>{targetLabels[guide]}</h4>
            <ToolInstallGuide app={guide} />
          </div>
        )}
      </section>
      <h2 className="rd-environment-health-title">{t("environmentHealth")}</h2>
      <p className="rd-alert rd-env-scope">
        <CircleHelp size={17} />
        {t("environmentScope")}
      </p>
      <section className="rd-setting-section rd-env-platform">
        <h3>{t("platformGuidance")}</h3>
        <p>
          {t("platformDetectedHint", { platform: t(`platform_${platform}`) })}
        </p>
        <label htmlFor="rd-guide-platform">{t("platformGuideFor")}</label>
        <select
          id="rd-guide-platform"
          className="rd-select"
          value={guidePlatform}
          onChange={(e) =>
            setGuidePlatform(e.target.value as EnvironmentPlatform)
          }
        >
          {Array.from(
            new Set<EnvironmentPlatform>([
              platform,
              "windows",
              "macos",
              "linux-desktop",
              "linux-server",
            ]),
          ).map((p) => (
            <option key={p} value={p}>
              {t(`platform_${p}`)}
            </option>
          ))}
        </select>
        <p className="rd-small rd-muted">
          {t(`platformHint_${guidePlatform}`)}
        </p>
      </section>
      <section className="rd-setting-section">
        <h3>{t("envSystemBase")}</h3>
        <ul className="rd-env-list">
          {systemCheckIds.map((id) => {
            const check = envRow(id);
            const fixable =
              envFixableIds.has(id) &&
              (check.status === "warn" || check.status === "error");
            return (
              <EnvironmentCheckRow key={id} check={check}>
                {fixable && (
                  <Action
                    disabled={fixing || busy}
                    onClick={() => {
                      if (!busy && !fixing)
                        setEnvFix({ id, label: check.label });
                    }}
                  >
                    {t("envFixInstall")}
                  </Action>
                )}
              </EnvironmentCheckRow>
            );
          })}
        </ul>
      </section>
      <section className="rd-setting-section">
        <h3>{t("envConnections")}</h3>
        <ul className="rd-env-list">
          {connectionCheckIds.map((id) => (
            <EnvironmentCheckRow key={id} check={envRow(id)} />
          ))}
        </ul>
      </section>
      <section className="rd-setting-section rd-env-diagnostics">
        <div>
          <h3>{t("dataDiagnostics")}</h3>
          <p>{t("envDiagnosticsScope")}</p>
        </div>
        <Action disabled={exporting} onClick={() => void exportLogs()}>
          <Download size={15} />
          {t(exporting ? "exporting" : "exportLogs")}
        </Action>
        {status && (
          <p
            role="status"
            className={`rd-alert ${status === "exported" ? "success" : "error"}`}
          >
            {t(status)}
          </p>
        )}
      </section>
      <div>
        <Action onClick={onBack}>
          <ArrowLeft size={14} />
          {t("backToModels")}
        </Action>
      </div>
      <InstallToolDialog
        app={install}
        onClose={() => setInstall(null)}
        onInstalled={recheck}
      />
      <EnvFixDialog
        check={envFix}
        onClose={() => setEnvFix(null)}
        onDone={recheck}
      />
    </div>
  );
}
