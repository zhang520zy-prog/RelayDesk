import { useState } from "react";
import { useQuery, useIsMutating } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  CircleHelp,
  AlertCircle,
  Loader2,
  RefreshCw,
  Download,
  MonitorX,
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
import { ToolInstallGuide } from "./ToolInstallGuide";
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

/** Codex 图像生成修复行：skill 未装或 ~/.env 缺配置时给一键修复 */
function CodexImageRow({
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
  const [failed, setFailed] = useState(false);
  const ready = !!status?.skillInstalled && !!status?.envReady;
  const check: EnvironmentCheck = loading
    ? {
        id: "codex-image",
        label: t("codexImageLabel"),
        status: "loading",
        detail: t("envCheckingTool"),
      }
    : !status?.repairable
      ? {
          id: "codex-image",
          label: t("codexImageLabel"),
          status: "warn",
          detail: t("codexImageNeedModel"),
          hint: t("codexImageNeedModelHint"),
        }
      : ready
        ? {
            id: "codex-image",
            label: t("codexImageLabel"),
            status: "ok",
            detail: t("codexImageReady"),
          }
        : {
            id: "codex-image",
            label: t("codexImageLabel"),
            status: "fixable",
            detail: t("codexImageMissing"),
          };
  return (
    <EnvironmentCheckRow check={check}>
      {check.status === "fixable" && (
        <Action
          disabled={fixing}
          onClick={() => {
            setFixing(true);
            setFailed(false);
            relayApi
              .codexImageFix()
              .then(onFixed)
              .catch(() => setFailed(true))
              .finally(() => setFixing(false));
          }}
        >
          {fixing ? <Loader2 size={13} className="rd-spin" /> : null}
          {t("codexImageFix")}
        </Action>
      )}
      {failed && <span className="rd-muted">{t("codexImageFixFailed")}</span>}
    </EnvironmentCheckRow>
  );
}

/** 厂商分组行：AI 工具按厂商折叠（如 OpenAI Codex = CLI + ChatGPT 桌面端），
 *  摘要行直接给各子项状态 chips；展开态由页面级 openGroups 受控，
 *  点哪组开哪组——探测数据晚到不再把其他组弹开。 */
function ToolVendorGroup({
  name,
  checks,
  expanded,
  onToggle,
  children,
}: {
  name: string;
  checks: { id: string; status: EnvironmentCheck["status"]; label: string }[];
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation("relaydesk");
  return (
    <li className="rd-env-group" data-open={expanded}>
      <button
        type="button"
        className="rd-env-group-head"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <strong>{name}</strong>
        <span className="rd-env-group-chips">
          {checks.map((c) => (
            <span
              key={c.id}
              className={`rd-env-chip ${c.status}`}
              data-status={c.status}
            >
              {c.label} · {t(`envStatus_${c.status}`)}
            </span>
          ))}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={expanded ? "rd-flip" : undefined}
        />
      </button>
      {/* 子行始终挂载、折叠时 hidden：检测即插即用，
          状态徽标与屏幕阅读器由 hidden 属性正确隐藏 */}
      <ul className="rd-env-group-body" hidden={!expanded}>
        {children}
      </ul>
    </li>
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
  const [guide, setGuide] = useState<string | null>(null);
  // 厂商分组展开态：页面级持有，子组件重挂载/探测刷新不丢用户选择；
  // 默认全收起，点哪组开哪组。
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
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
        <ul className="rd-env-list">
          {deployableIds.map((app) => {
            const check = toolCheck(app);
            const desktop = desktopCheck(app);
            const found = installations.data?.find((item) => item.app === app);
            const vendor = check.label.replace(/\s*CLI\s*$/i, "");
            const groupChecks = [
              { id: `${app}-cli`, status: check.status, label: "CLI" },
              ...(desktop
                ? [
                    {
                      id: desktop.id,
                      status: desktop.status,
                      label: t("desktopChip"),
                    },
                  ]
                : []),
            ];
            return (
              <ToolVendorGroup
                key={app}
                name={vendor}
                checks={groupChecks}
                expanded={openGroups[app] ?? false}
                onToggle={() =>
                  setOpenGroups((s) => ({ ...s, [app]: !(s[app] ?? false) }))
                }
              >
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
                  {check.repairable && (
                    <Action
                      disabled={installing || busy}
                      onClick={() => {
                        if (!busy && !installing) setInstall(app);
                      }}
                    >
                      {t("envToolRepair")}
                    </Action>
                  )}
                  {check.status !== "loading" && check.status !== "ok" && (
                    <Action
                      aria-expanded={guide === app}
                      onClick={() => setGuide(guide === app ? null : app)}
                    >
                      {t("viewInstallGuide")}
                    </Action>
                  )}
                </EnvironmentCheckRow>
                {/* 指引紧跟点击行内联展开，不再跳到列表底部 */}
                {guide === app && (
                  <li className="rd-env-guide-row">
                    <ToolInstallGuide app={app} />
                  </li>
                )}
                {desktop && (
                  <EnvironmentCheckRow key={desktop.id} check={desktop}>
                    {found?.desktopUrl &&
                      (desktop.status === "info" ||
                        desktop.status === "warn" ||
                        desktop.status === "unsupported") && (
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
                  </EnvironmentCheckRow>
                )}
                {app === "codex" && (
                  <CodexImageRow
                    status={codexImage.data}
                    loading={codexImage.isPending}
                    onFixed={() => void codexImage.refetch()}
                  />
                )}
              </ToolVendorGroup>
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
