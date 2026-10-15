import { useState } from "react";
import { useQuery, useIsMutating } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  CircleHelp,
  AlertCircle,
  Check,
  Loader2,
  RefreshCw,
  Download,
  Monitor,
  MonitorX,
  Image,
  Terminal,
  Info,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { relayApi, type RelayAccountInfo } from "@/lib/api/relay";
import { settingsApi } from "@/lib/api/settings";
import { Action } from "../ui";
import { OnboardingChecklist } from "../onboarding/OnboardingChecklist";
import {
  targetIds,
  targetLabels,
  deployOnlyIds,
  deployOnlyLabels,
} from "../state/useRelayApply";

/** 部署页循环体覆盖的全部工具：apply 目标 + 仅可安装检测的工具 */
const deployableIds = [...targetIds, ...deployOnlyIds] as string[];
const allToolLabels: Record<string, string> = {
  ...targetLabels,
  ...deployOnlyLabels,
};
import { relayErrorKey } from "../state/relayErrors";
import { InstallToolDialog } from "./InstallToolDialog";
import { EnvFixDialog } from "./EnvFixDialog";
import { TOOL_VENDORS } from "./toolIcons";
import { getRuntimePlatform, type EnvironmentPlatform } from "./platform";
import type { EnvironmentCheck } from "./environmentTypes";
import "./environment.css";

const statusIcons = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: AlertCircle,
  fixable: Download,
  info: Info,
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
        {check.hint && <small className="rd-env-hint">{check.hint}</small>}
      </div>
      <span className={`rd-env-status ${check.status}`}>
        {t(`envStatus_${check.status}`)}
      </span>
      {children && <div className="rd-env-row-actions">{children}</div>}
    </li>
  );
}

/** Codex 图像生成修复槽位：skill 未装或 ~/.env 缺配置时点击即修复；
 *  词汇与安装槽位统一：已安装 / 未安装。 */
function CodexImageSlot({
  status,
  loading,
  onFixed,
}: {
  status:
    | { skillInstalled: boolean; envReady: boolean; repairable: boolean }
    | undefined;
  loading: boolean;
  onFixed: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const [fixing, setFixing] = useState(false);
  const ready = !!status?.skillInstalled && !!status?.envReady;
  const state: SlotState = loading
    ? "loading"
    : ready
      ? "installed"
      : "missing";
  return (
    <ToolSlot
      icon={<Image size={14} />}
      label={t("codexImageLabel")}
      state={state}
      hint={
        loading
          ? undefined
          : !status?.repairable && !ready
            ? t("codexImageNeedModelHint")
            : t("codexImageFix")
      }
      onClick={
        !loading && !ready && status?.repairable && !fixing
          ? () => {
              setFixing(true);
              relayApi
                .codexImageFix()
                .then(onFixed)
                .catch(() => undefined)
                .finally(() => setFixing(false));
            }
          : undefined
      }
    />
  );
}

/** 安装槽位状态词统一为「已安装 / 未安装」两级——未安装即入口（点击即装）；
 *  探测失败是异常不是安装态，单独呈现「检查失败」不冒充"未安装"。 */
type SlotState = "loading" | "installed" | "missing" | "error";

/** AI 工具行内的单个安装槽位（桌面端 或 CLI）。 */
function ToolSlot({
  icon,
  label,
  state,
  hint,
  warn = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  state: SlotState;
  hint?: string;
  /** 已装但异常（如损坏可修复）：仍显示"已安装"但可点击处理 */
  warn?: boolean;
  onClick?: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const clickable = state !== "loading" && !!onClick;
  return (
    <button
      type="button"
      className={`rd-env-slot ${state}${warn ? " warn" : ""}`}
      disabled={!clickable}
      onClick={clickable ? onClick : undefined}
      title={hint}
    >
      <span className="rd-env-slot-icon">{icon}</span>
      <span className="rd-env-slot-label">{label}</span>
      <span className="rd-env-slot-state">
        {state === "loading" ? (
          <Loader2 size={12} className="rd-spin" aria-hidden />
        ) : state === "installed" ? (
          <Check size={12} aria-hidden />
        ) : state === "error" ? (
          <AlertCircle size={12} aria-hidden />
        ) : (
          <Download size={12} aria-hidden />
        )}
        {state === "loading"
          ? t("envCheckingTool")
          : state === "installed"
            ? t("envInstalled")
            : state === "error"
              ? t("envStatus_error")
              : t("envNotInstalled")}
      </span>
    </button>
  );
}

export function EnvironmentPage({
  onBack,
  platform = getRuntimePlatform(),
  busy = false,
  account,
  applied = false,
  openTargets,
  openModels,
}: {
  onBack: () => void;
  platform?: EnvironmentPlatform;
  busy?: boolean;
  account?: RelayAccountInfo;
  applied?: boolean;
  openTargets?: () => void;
  openModels?: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const [install, setInstall] = useState<string | null>(null);
  const [envFix, setEnvFix] = useState<{ id: string; label: string } | null>(
    null,
  );
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
    queryFn: () => settingsApi.getToolVersions(deployableIds),
    ...queryOptions,
  });
  const doctor = useQuery({
    queryKey: ["relaydesk", "environment", "doctor"],
    queryFn: relayApi.envCheck,
    ...queryOptions,
  });
  const codexImage = useQuery({
    queryKey: ["relaydesk", "codex-image"],
    queryFn: relayApi.codexImageStatus,
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
  function toolCheck(app: string): EnvironmentCheck {
    // CLI 行显式带 CLI 后缀，避免与下方"桌面端"行混淆（如 OpenAI Codex CLI vs ChatGPT 桌面端）
    const cliName = (allToolLabels[app] ?? app).replace(/\s*CLI\s*$/i, "");
    const base = { id: `${app}-cli`, label: `${cliName} CLI` };
    if (loading)
      return { ...base, status: "loading", detail: t("envCheckingTool") };
    const found = installations.data?.find((item) => item.app === app);
    const version = versions.data?.find((item) => item.name === app);
    if (!versions.isError && version?.installed_but_broken)
      return {
        ...base,
        status: "warn",
        detail: t("envToolBroken"),
        // 原始探测错误可能含路径等内部细节，不上屏；给通用排查提示
        hint: t("envToolBrokenHint"),
        repairable: true,
      };
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
  function desktopCheck(app: string): EnvironmentCheck | null {
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
    // macOS/Windows 均已实现桌面端探测；其余平台无定义可匹配，保持"暂不支持"。
    if (platform !== "macos" && platform !== "windows")
      return {
        ...base,
        status: "unsupported",
        detail: t("envDesktopUnsupported"),
      };
    return {
      ...base,
      status: "info",
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
      {account && openTargets && openModels && (
        <OnboardingChecklist
          account={account}
          applied={applied}
          openTargets={openTargets}
          openModels={openModels}
        />
      )}
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
        <ul className="rd-env-list rd-env-tools">
          {deployableIds.map((app) => {
            const check = toolCheck(app);
            const desktop = desktopCheck(app);
            const found = installations.data?.find((item) => item.app === app);
            const meta = TOOL_VENDORS[app];
            const cliState: SlotState =
              check.status === "loading"
                ? "loading"
                : check.status === "error"
                  ? "error"
                  : check.status === "ok" ||
                      (check.status === "warn" && !!check.repairable) ||
                      (check.status === "warn" && !!found?.cliPath)
                    ? "installed"
                    : "missing";
            const desktopState: SlotState =
              desktop == null
                ? "missing"
                : desktop.status === "loading"
                  ? "loading"
                  : desktop.status === "ok"
                    ? "installed"
                    : "missing";
            return (
              <li key={app} className="rd-env-tool">
                <div className="rd-env-tool-brand">
                  {meta ? <meta.Icon size={24} /> : null}
                  <span className="rd-env-tool-name">
                    <strong>{meta?.name ?? app}</strong>
                    {check.status === "ok" && check.detail ? (
                      <small>{check.detail}</small>
                    ) : null}
                  </span>
                </div>
                <div className="rd-env-tool-actions">
                  {desktop !== null && (
                    <ToolSlot
                      icon={<Monitor size={14} />}
                      label={t("envSlotDesktop")}
                      state={desktopState}
                      hint={
                        desktop?.status === "unsupported"
                          ? t("envDesktopUnsupported")
                          : found?.desktopUrl
                            ? found.desktopUrl
                            : check.status === "loading"
                              ? undefined
                              : t("envDesktopMissingOptional")
                      }
                      onClick={
                        desktopState === "missing" &&
                        desktop?.status !== "unsupported" &&
                        found?.desktopUrl
                          ? () =>
                              void relayApi
                                .openDesktopDownload(app)
                                .catch((e) => setStatus(relayErrorKey(e)))
                          : undefined
                      }
                    />
                  )}
                  <ToolSlot
                    icon={<Terminal size={14} />}
                    label={t("envSlotCli")}
                    state={cliState}
                    warn={!!check.repairable}
                    hint={
                      check.status === "ok"
                        ? check.detail
                        : check.repairable
                          ? t("envToolBroken")
                          : undefined
                    }
                    onClick={
                      !busy &&
                      !installing &&
                      (cliState === "missing" || check.repairable)
                        ? () => setInstall(app)
                        : undefined
                    }
                  />
                  {app === "codex" && (
                    <CodexImageSlot
                      status={codexImage.data}
                      loading={codexImage.isPending}
                      onFixed={() => void codexImage.refetch()}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
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
        repair={Boolean(
          install &&
            versions.data?.find(
              (item) => item.name === install && item.installed_but_broken,
            ),
        )}
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
