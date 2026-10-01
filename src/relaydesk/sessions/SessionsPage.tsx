import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Code,
  Sparkles,
  Terminal,
  Trash2,
  Loader2,
  MessageSquareText,
  Search,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import {
  relaydeskSessionApi,
  type RelaySessionMeta,
} from "@/lib/api/relaydesk-sessions";
import { targetLabels } from "../state/useRelayApply";

const providerIcons: Record<string, typeof Bot> = {
  claude: Bot,
  codex: Code,
  gemini: Sparkles,
};

const providerOrder = ["claude", "codex", "gemini"];

function providerLabel(id: string) {
  return targetLabels[id as keyof typeof targetLabels] ?? id;
}

function AiToolIcon({ id }: { id: string }) {
  const Icon = providerIcons[id] ?? Terminal;
  return <Icon size={16} aria-hidden="true" />;
}

function sessionKey(
  session: Pick<RelaySessionMeta, "providerId" | "sessionId">,
) {
  return `${session.providerId}:${session.sessionId}`;
}

function formatDate(ts?: number) {
  if (!ts) return undefined;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return undefined;
  }
}

export function SessionsPage() {
  const { t } = useTranslation("relaydesk");
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["relaydesk", "sessions"],
    queryFn: () => relaydeskSessionApi.list(),
    retry: false,
    staleTime: 30_000,
  });
  const [selected, setSelected] = useState<RelaySessionMeta | null>(null);
  const [search, setSearch] = useState("");
  const [resumeBusy, setResumeBusy] = useState(false);

  const messages = useQuery({
    queryKey: [
      "relaydesk",
      "session-messages",
      selected?.providerId,
      selected?.sourcePath,
    ],
    queryFn: () =>
      relaydeskSessionApi.messages(selected!.providerId, selected!.sourcePath!),
    enabled: Boolean(selected && selected.sourcePath),
    retry: false,
    staleTime: 30_000,
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, RelaySessionMeta[]>();
    const needle = search.trim().toLowerCase();
    const items = (list.data ?? []).filter((session) => {
      if (!needle) return true;
      return [
        session.title,
        session.summary,
        session.projectDir,
        session.sessionId,
      ]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle));
    });
    for (const session of items) {
      const arr = groups.get(session.providerId) ?? [];
      arr.push(session);
      groups.set(session.providerId, arr);
    }
    for (const arr of groups.values()) {
      arr.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
    }
    const ids = Array.from(groups.keys()).sort(
      (a, b) =>
        (providerOrder.indexOf(a) === -1 ? 99 : providerOrder.indexOf(a)) -
        (providerOrder.indexOf(b) === -1 ? 99 : providerOrder.indexOf(b)),
    );
    return { ids, groups };
  }, [list.data, search]);

  const handleDelete = async (
    session: RelaySessionMeta,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    if (!session.sourcePath) return;
    if (
      !window.confirm(
        t("confirmDeleteSession", {
          title: session.title ?? session.sessionId,
        }),
      )
    )
      return;
    try {
      await relaydeskSessionApi.delete(
        session.providerId,
        session.sessionId,
        session.sourcePath,
      );
      if (selected && sessionKey(selected) === sessionKey(session))
        setSelected(null);
      await client.invalidateQueries({ queryKey: ["relaydesk", "sessions"] });
    } catch {
      toast.error(t("deleteSessionFailed"));
    }
  };

  const handleResume = async (session: RelaySessionMeta) => {
    if (!session.resumeCommand || resumeBusy) return;
    setResumeBusy(true);
    try {
      const ok = await relaydeskSessionApi.launchTerminal(
        session.resumeCommand,
        session.projectDir ?? null,
      );
      if (!ok) toast.error(t("resumeSessionFailed"));
    } catch {
      toast.error(t("resumeSessionFailed"));
    } finally {
      setResumeBusy(false);
    }
  };

  return (
    <div className="rd-sessions-page">
      <div className="rd-sessions-layout">
        <section className="rd-sessions-list" aria-label={t("sessions")}>
          <div className="rd-session-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchSessions")}
              aria-label={t("searchSessions")}
            />
          </div>
          {list.isPending && (
            <div className="rd-sessions-empty" role="status">
              <Loader2 size={18} className="rd-spin" />
              {t("loadingSessions")}
            </div>
          )}
          {list.isError && (
            <div className="rd-sessions-empty" role="alert">
              {t("sessionLoadError")}
            </div>
          )}
          {!list.isPending && grouped.ids.length === 0 && (
            <div className="rd-sessions-empty">
              <MessageSquareText size={32} />
              <p>{t("noSessions")}</p>
            </div>
          )}
          {grouped.ids.map((providerId) => {
            const sessions = grouped.groups.get(providerId) ?? [];
            return (
              <div key={providerId} className="rd-session-provider">
                <h2>
                  <AiToolIcon id={providerId} />
                  {providerLabel(providerId)}
                  <span className="rd-muted">{sessions.length}</span>
                </h2>
                <ul>
                  {sessions.map((session) => (
                    <li key={sessionKey(session)}>
                      <button
                        type="button"
                        className={`rd-session-item ${
                          selected &&
                          sessionKey(selected) === sessionKey(session)
                            ? "is-active"
                            : ""
                        }`}
                        onClick={() => setSelected(session)}
                        aria-current={
                          selected &&
                          sessionKey(selected) === sessionKey(session)
                            ? "true"
                            : undefined
                        }
                      >
                        <span className="rd-session-title">
                          {session.title ?? session.sessionId}
                        </span>
                        {session.summary && (
                          <span className="rd-session-summary">
                            {session.summary}
                          </span>
                        )}
                        <span className="rd-session-meta">
                          {formatDate(session.lastActiveAt) ?? t("unknownTime")}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="rd-session-delete"
                        aria-label={t("deleteSession")}
                        onClick={(e) => handleDelete(session, e)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
        <section
          className="rd-sessions-detail"
          aria-label={t("sessionMessages")}
        >
          {!selected ? (
            <div className="rd-sessions-empty">
              <MessageSquareText size={32} />
              <p>{t("selectSession")}</p>
            </div>
          ) : messages.isPending ? (
            <div className="rd-sessions-empty" role="status">
              <Loader2 size={18} className="rd-spin" />
              {t("loadingMessages")}
            </div>
          ) : messages.isError ? (
            <div className="rd-sessions-empty" role="alert">
              {t("sessionMessageError")}
            </div>
          ) : messages.data && messages.data.length > 0 ? (
            <>
              <header className="rd-sessions-detail-header">
                <h3>{selected.title ?? selected.sessionId}</h3>
                <div className="rd-sessions-detail-actions">
                  <span className="rd-muted">
                    {providerLabel(selected.providerId)}
                  </span>
                  {selected.resumeCommand && (
                    <button
                      type="button"
                      className="rd-session-resume"
                      disabled={resumeBusy}
                      onClick={() => void handleResume(selected)}
                      aria-label={t("resumeSession")}
                      title={t("resumeSession")}
                    >
                      {resumeBusy ? (
                        <Loader2
                          size={13}
                          className="rd-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Play size={13} aria-hidden="true" />
                      )}
                      <span>{t("resumeSession")}</span>
                    </button>
                  )}
                </div>
              </header>
              <ol className="rd-session-messages">
                {messages.data.map((msg, idx) => (
                  <li
                    key={idx}
                    className={`rd-session-message rd-session-message--${msg.role}`}
                  >
                    <span className="rd-session-message-role">{msg.role}</span>
                    <p>{msg.content}</p>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="rd-sessions-empty">
              <p>{t("sessionMessageEmpty")}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
