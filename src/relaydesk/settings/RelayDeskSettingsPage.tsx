import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  Download,
  Folder,
  LogOut,
  Moon,
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
                <Icon size={15} />
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
              localStorage.setItem("language", e.target.value);
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
    </div>
  );
}
