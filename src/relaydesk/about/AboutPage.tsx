import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  Download,
  ExternalLink,
  Github,
  RefreshCw,
} from "lucide-react";
import { relayApi } from "@/lib/api/relay";
import { settingsApi } from "@/lib/api/settings";
import { version } from "../../../package.json";
import { Action } from "../ui";

const PROJECT_URL = "https://github.com/zhang520zy-prog/RelayDesk";
const ISSUES_URL = `${PROJECT_URL}/issues`;

type UpdateResult =
  | {
      kind: "available";
      version: string;
      notes?: string;
      date?: string;
    }
  | {
      kind: "latest" | "not_configured" | "check_failed" | "install_failed";
    };

export function AboutPage() {
  const { t } = useTranslation("relaydesk");
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);

  async function checkUpdate() {
    if (checking || installing) return;
    setChecking(true);
    try {
      const data = await relayApi.checkUpdate();
      setResult(
        !data.configured
          ? { kind: "not_configured" }
          : data.version
            ? {
                kind: "available",
                version: data.version,
                notes: data.notes ?? undefined,
                date: data.date ?? undefined,
              }
            : { kind: "latest" },
      );
    } catch {
      setResult({ kind: "check_failed" });
    } finally {
      setChecking(false);
    }
  }

  async function installUpdate() {
    if (installing) return;
    setInstalling(true);
    try {
      await settingsApi.installUpdateAndRestart();
    } catch {
      setResult({ kind: "install_failed" });
      setInstalling(false);
    }
  }

  const busy = checking || installing;
  const statusText = checking
    ? t("checkingUpdate")
    : installing
      ? t("updating")
      : result
        ? result.kind === "available"
          ? t("updateAvailable", { version: result.version })
          : t(`update_${result.kind}`)
        : t("updateIdle");
  return (
    <div className="rd-settings rd-about-page">
      <section className="rd-setting-section">
        <div className="rd-about-head">
          <h2>{t("aboutTitle")}</h2>
          <span className="rd-muted rd-small">{t("aboutTagline")}</span>
        </div>
        <div className="rd-setting-row">
          <span>{t("aboutAppName")}</span>
          <strong>RelayDesk</strong>
        </div>
        <div className="rd-setting-row">
          <span>{t("currentVersion")}</span>
          <code>{version}</code>
        </div>
        <div className="rd-setting-row">
          <span>{t("projectHome")}</span>
          <code className="rd-about-url">
            {PROJECT_URL.replace("https://", "")}
          </code>
        </div>
        <div className="rd-setting-actions">
          <Action
            onClick={() => void settingsApi.openExternal(PROJECT_URL)}
            aria-label={t("openProject")}
          >
            <Github size={15} />
            {t("openProject")}
          </Action>
          <Action
            onClick={() => void settingsApi.openExternal(ISSUES_URL)}
            aria-label={t("reportIssue")}
          >
            <ExternalLink size={14} />
            {t("reportIssue")}
          </Action>
        </div>
      </section>
      <section className="rd-setting-section">
        <div className="rd-about-head">
          <h2>{t("releaseUpdate")}</h2>
          <span className="rd-muted rd-small">
            {t("currentVersion")} {version}
          </span>
        </div>
        <div className="rd-setting-row">
          <span>{t("updateStatusLabel")}</span>
          <span role="status">{statusText}</span>
        </div>
        {result?.kind === "available" && result.date && (
          <div className="rd-setting-row">
            <span>{t("releaseDate")}</span>
            <span>{result.date.split("T")[0]}</span>
          </div>
        )}
        {result?.kind === "available" && result.notes && (
          <pre className="rd-about-notes" aria-label={t("releaseNotes")}>
            {result.notes}
          </pre>
        )}
        <div className="rd-setting-actions">
          {result?.kind === "available" ? (
            <Action
              primary
              disabled={busy}
              onClick={() => void installUpdate()}
            >
              <Download size={15} />
              {t(installing ? "updating" : "updateAndRestart")}
            </Action>
          ) : (
            <Action disabled={busy} onClick={() => void checkUpdate()}>
              <RefreshCw size={15} className={checking ? "rd-spin" : ""} />
              {t(checking ? "checkingUpdate" : "checkUpdate")}
            </Action>
          )}
          <Action
            onClick={() =>
              void settingsApi.openExternal(`${PROJECT_URL}/releases`)
            }
            aria-label={t("viewReleases")}
          >
            <ArrowUpRight size={14} />
            {t("viewReleases")}
          </Action>
        </div>
      </section>
    </div>
  );
}
