import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowUpRight,
  Download,
  ExternalLink,
  Github,
  RefreshCw,
} from "lucide-react";
import { relayApi } from "@/lib/api/relay";
import { settingsApi } from "@/lib/api/settings";
import {
  beginUpdateInstall,
  endUpdateInstall,
  updateInstallInFlight,
} from "@/lib/api/updateInstall";
import { version } from "../../../package.json";
import { Action } from "../ui";

const PROJECT_URL = "https://github.com/zhang520zy-prog/RelayDesk";
const ISSUES_URL = `${PROJECT_URL}/issues`;

function renderInline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("`") && part.endsWith("`") ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
}

const INTERNAL_SECTION = /^\s*(工程|下载|安装|engineering|download|install)/i;

// 应用内更新日志只展示用户可感知的内容：剥掉版本标题行与工程/下载/安装类段落，
// 完整版本仍以 GitHub Release 页为准。
function filterAppNotes(notes: string): string {
  const withoutTitle = notes.replace(/^\s*#{1,2}\s+[^\n]*\n+/, "");
  const sections = withoutTitle.split(/(?=^#{2,4}\s)/m);
  return sections
    .filter((s) => {
      const heading = s.match(/^#{2,4}\s+(.*)/);
      return !heading || !INTERNAL_SECTION.test(heading[1]);
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderNotes(notes: string): ReactNode[] {
  return notes.split("\n").map((line, i) => {
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    if (heading) {
      const level = Math.min(heading[1].length, 2);
      return (
        <div key={i} className={`rd-notes-h rd-notes-h${level}`}>
          {renderInline(heading[2])}
        </div>
      );
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)/);
    if (bullet) {
      return (
        <div key={i} className="rd-notes-li">
          <span className="rd-notes-bullet" aria-hidden="true">
            •
          </span>
          <span>{renderInline(bullet[1])}</span>
        </div>
      );
    }
    const quote = line.match(/^>\s?(.*)/);
    if (quote) {
      return (
        <div key={i} className="rd-notes-quote">
          {renderInline(quote[1])}
        </div>
      );
    }
    if (!line.trim()) return <div key={i} className="rd-notes-gap" />;
    return <div key={i}>{renderInline(line)}</div>;
  });
}

function notesDate(date?: string): string | undefined {
  return date?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? date;
}

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
  // 横幅入口可能已发起安装：进入本页时同步在途状态
  const [installing, setInstalling] = useState(updateInstallInFlight);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [progress, setProgress] = useState<{
    downloaded: number;
    total?: number;
  } | null>(null);

  useEffect(() => {
    const unlisten = listen<{ downloaded: number; total?: number }>(
      "update-download-progress",
      (e) => setProgress(e.payload),
    );
    return () => {
      void unlisten.then((u) => u());
    };
  }, []);

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
    if (!beginUpdateInstall()) {
      // 更新横幅已发起安装：本页仅同步显示安装中
      setInstalling(true);
      return;
    }
    setProgress(null);
    setInstalling(true);
    try {
      await settingsApi.installUpdateAndRestart();
    } catch {
      endUpdateInstall();
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
            <span>{notesDate(result.date)}</span>
          </div>
        )}
        {result?.kind === "available" && result.notes && !installing && (
          <div className="rd-about-notes" aria-label={t("releaseNotes")}>
            {renderNotes(filterAppNotes(result.notes))}
          </div>
        )}
        {installing && (
          <div className="rd-update-progress" role="progressbar">
            <div className="rd-update-progress-bar">
              <i
                style={{
                  width:
                    progress?.total && progress.total > 0
                      ? `${Math.min(100, Math.round((progress.downloaded / progress.total) * 100))}%`
                      : undefined,
                }}
                className={progress?.total ? "" : "rd-update-progress--indet"}
              />
            </div>
            <span className="rd-update-progress-text">
              {progress?.total
                ? `${Math.min(100, Math.round((progress.downloaded / progress.total) * 100))}%`
                : progress
                  ? `${(progress.downloaded / 1024 / 1024).toFixed(1)} MB`
                  : t("updating")}
            </span>
          </div>
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
