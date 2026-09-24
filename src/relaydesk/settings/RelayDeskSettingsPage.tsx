import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  Download,
  Folder,
  LogOut,
  Moon,
  RefreshCw,
  Sun,
  Monitor,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { relayApi, type RelayAccountInfo } from "@/lib/api/relay";
import { settingsApi } from "@/lib/api/settings";
import { version } from "../../../package.json";
import { Action } from "../ui";
import { relayErrorKey } from "../state/relayErrors";
export function RelayDeskSettingsPage({
  account,
  busy,
  refresh,
  logout,
}: {
  account: RelayAccountInfo;
  busy: boolean;
  refresh: () => void;
  logout: () => void;
}) {
  const { t, i18n } = useTranslation("relaydesk");
  const { theme, setTheme } = useTheme();
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<
    | { kind: "not_configured" | "latest" | "check_failed" | "install_failed" }
    | { kind: "available"; version: string }
    | null
  >(null);
  const path = useQuery({
    queryKey: ["relaydesk", "dataPath"],
    queryFn: settingsApi.getAppConfigPath,
    staleTime: Infinity,
    retry: false,
  });
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
  async function checkUpdate() {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      const result = await relayApi.checkUpdate();
      setUpdateResult(
        !result.configured
          ? { kind: "not_configured" }
          : result.version
            ? { kind: "available", version: result.version }
            : { kind: "latest" },
      );
    } catch {
      setUpdateResult({ kind: "check_failed" });
    } finally {
      setCheckingUpdate(false);
    }
  }
  async function installUpdate() {
    if (installingUpdate) return;
    setInstallingUpdate(true);
    try {
      await settingsApi.installUpdateAndRestart();
    } catch {
      setUpdateResult({ kind: "install_failed" });
      setInstallingUpdate(false);
    }
  }
  return (
    <div className="rd-settings">
      <section className="rd-setting-section">
        <h2>{t("account")}</h2>
        <div className="rd-setting-row">
          <span>{t("username")}</span>
          <strong>{account.username}</strong>
        </div>
        <div className="rd-setting-row">
          <span>{t("instance")}</span>
          <code title={account.baseUrl}>{account.baseUrl}</code>
        </div>
        <div className="rd-setting-actions">
          <Action disabled={busy} onClick={refresh}>
            {t("refreshAccount")}
          </Action>
          <Action disabled={busy} onClick={logout}>
            <LogOut size={15} />
            {t("logout")}
          </Action>
        </div>
      </section>
      <section className="rd-setting-section">
        <h2>{t("appearance")}</h2>
        <div className="rd-setting-row">
          <span>{t("theme")}</span>
          <div
            className="rd-theme-options"
            role="group"
            aria-label={t("theme")}
          >
            {(
              [
                { value: "dark", Icon: Moon },
                { value: "light", Icon: Sun },
                { value: "system", Icon: Monitor },
              ] as const
            ).map(({ value, Icon }) => (
              <button
                key={value}
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
              >
                <Icon size={15} aria-hidden="true" />
                {t(value)}
              </button>
            ))}
          </div>
        </div>
        <div className="rd-setting-row">
          <label htmlFor="rd-language">{t("language")}</label>
          <select
            id="rd-language"
            className="rd-select"
            value={i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en"}
            onChange={(e) => {
              try {
                localStorage.setItem("language", e.target.value);
              } catch {
                /* Language still changes for this session. */
              }
              void i18n.changeLanguage(e.target.value);
            }}
          >
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </section>
      <section className="rd-setting-section">
        <h2>{t("dataDiagnostics")}</h2>
        <div className="rd-data-path">
          <span>{t("dataDirectory")}</span>
          <code>
            {path.data
              ? path.data.replace(/[\\/][^\\/]+$/, "")
              : path.isPending
                ? "…"
                : t("pathUnavailable")}
          </code>
          <Action
            aria-label={t("openData")}
            onClick={() =>
              void settingsApi
                .openAppConfigFolder()
                .catch((e) => setStatus(relayErrorKey(e)))
            }
          >
            <Folder size={15} />
            <ArrowUpRight size={13} />
          </Action>
        </div>
        <div className="rd-diagnostics">
          <p>{t("diagnosticsHint")}</p>
          <Action disabled={exporting} onClick={() => void exportLogs()}>
            <Download size={15} />
            {t(exporting ? "exporting" : "exportLogs")}
          </Action>
        </div>
        {status && (
          <p
            role="status"
            className={`rd-alert ${status === "exported" ? "success" : "error"}`}
          >
            {t(status)}
          </p>
        )}
        <div className="rd-setting-row rd-version">
          <span>RelayDesk</span>
          <span>
            {t("version")} {version}
          </span>
        </div>
      </section>
      <section className="rd-setting-section">
        <h2>{t("appUpdate")}</h2>
        <p className="rd-muted rd-small">{t("appUpdateHint")}</p>
        {updateResult?.kind === "available" ? (
          <div className="rd-setting-actions">
            <p role="status" className="rd-alert success">
              {t("updateAvailable", { version: updateResult.version })}
            </p>
            <Action
              primary
              disabled={installingUpdate || busy}
              onClick={() => void installUpdate()}
            >
              <Download size={15} />
              {t(installingUpdate ? "updating" : "updateAndRestart")}
            </Action>
          </div>
        ) : (
          <div className="rd-setting-actions">
            {updateResult && (
              <p
                role="status"
                className={`rd-alert ${
                  updateResult.kind === "latest" ? "success" : "error"
                }`}
              >
                {t(`update_${updateResult.kind}`)}
              </p>
            )}
            <Action
              disabled={checkingUpdate || installingUpdate || busy}
              onClick={() => void checkUpdate()}
            >
              <RefreshCw
                size={15}
                className={checkingUpdate ? "rd-spin" : ""}
              />
              {t(checkingUpdate ? "checkingUpdate" : "checkUpdate")}
            </Action>
          </div>
        )}
      </section>
    </div>
  );
}
