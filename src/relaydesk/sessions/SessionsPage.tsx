import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Code,
  Sparkles,
  Terminal,
  Trash2,
  ChevronDown,
  Loader2,
  MessageSquareText,
  Monitor,
  Search,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  Copy,
  TerminalSquare,
} from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import {
  relaydeskSessionApi,
  type RelaySessionMeta,
} from "@/lib/api/relaydesk-sessions";
import { relayApi } from "@/lib/api/relay";
import { targetLabels } from "../state/useRelayApply";

const providerIcons: Record<string, typeof Bot> = {
  claude: Bot,
  codex: Code,
  gemini: Sparkles,
};

const providerOrder = ["claude", "codex", "gemini"];

/** 会话 providerId → relay_launch_target 目标 app 名（grokbuild 是内部名，
 *  桌面端目标叫 grok）。不在表内的 provider 没有桌面端入口。 */
const desktopAppOf: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  grokbuild: "grok",
  grok: "grok",
};

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
  const [collapsed, setCollapsed] = useState(false);

  // 各目标桌面端安装状态——决定"在桌面端打开"是否可用
  const installations = useQuery({
    queryKey: ["relaydesk", "environment", "installations"],
    queryFn: () => relayApi.detectTargetInstallations(),
    retry: false,
    staleTime: 60_000,
  });

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

  /** 该会话供应商的桌面端是否已安装 */
  const desktopInstallFor = (providerId: string) => {
    const app = desktopAppOf[providerId];
    if (!app) return null;
    const inst = installations.data?.find((i) => i.app === app);
    return inst?.desktopApp ? { app, name: inst.desktopName ?? app } : null;
  };

  const handleResumeDesktop = async (session: RelaySessionMeta) => {
    const desktop = desktopInstallFor(session.providerId);
    if (!desktop || resumeBusy) return;
    setResumeBusy(true);
    try {
      await relaydeskSessionApi.launchDesktop(desktop.app);
    } catch {
      toast.error(t("resumeSessionFailed"));
    } finally {
      setResumeBusy(false);
    }
  };

  return (
    <div className="rd-sessions-page">
      <div className={`rd-sessions-layout ${collapsed ? "is-collapsed" : ""}`}>
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
            <button
              type="button"
              className="rd-sessions-collapse"
              aria-label={t("collapseSessions")}
              aria-expanded={!collapsed}
              title={t("collapseSessions")}
              onClick={() => setCollapsed(true)}
            >
              <PanelLeftClose size={14} aria-hidden="true" />
            </button>
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
                        title={session.title ?? session.sessionId}
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
          {collapsed && (
            <button
              type="button"
              className="rd-sessions-expand"
              aria-label={t("expandSessions")}
              title={t("expandSessions")}
              onClick={() => setCollapsed(false)}
            >
              <PanelLeftOpen size={14} aria-hidden="true" />
            </button>
          )}
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
                <h3 title={selected.title ?? selected.sessionId}>
                  {selected.title ?? selected.sessionId}
                </h3>
                <div className="rd-sessions-detail-actions">
                  <span className="rd-muted">
                    {providerLabel(selected.providerId)}
                  </span>
                  {(selected.resumeCommand ||
                    desktopInstallFor(selected.providerId)) && (
                    <DropdownMenuPrimitive.Root>
                      <DropdownMenuPrimitive.Trigger asChild>
                        <button
                          type="button"
                          className="rd-session-resume"
                          disabled={resumeBusy}
                          aria-label={t("resumeWhere")}
                          title={t("resumeWhere")}
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
                          <span>{t("resumeWhere")}</span>
                          <ChevronDown size={12} aria-hidden="true" />
                        </button>
                      </DropdownMenuPrimitive.Trigger>
                      <DropdownMenuPrimitive.Portal>
                        <DropdownMenuPrimitive.Content
                          className="rd-resume-menu"
                          align="end"
                          sideOffset={6}
                        >
                          {selected.resumeCommand && (
                            <DropdownMenuPrimitive.Item
                              className="rd-resume-menu__item"
                              onSelect={() => void handleResume(selected)}
                            >
                              <TerminalSquare size={13} aria-hidden="true" />
                              <div className="rd-resume-menu__text">
                                <span>{t("resumeSession")}</span>
                                <small className="rd-muted">
                                  {t("resumeSessionHint")}
                                </small>
                              </div>
                            </DropdownMenuPrimitive.Item>
                          )}
                          {desktopInstallFor(selected.providerId) && (
                            <DropdownMenuPrimitive.Item
                              className="rd-resume-menu__item"
                              onSelect={() =>
                                void handleResumeDesktop(selected)
                              }
                            >
                              <Monitor size={13} aria-hidden="true" />
                              <div className="rd-resume-menu__text">
                                <span>{t("resumeInDesktop")}</span>
                                <small className="rd-muted">
                                  {t("resumeInDesktopHint", {
                                    name:
                                      desktopInstallFor(selected.providerId)
                                        ?.name ?? "",
                                  })}
                                </small>
                              </div>
                            </DropdownMenuPrimitive.Item>
                          )}
                        </DropdownMenuPrimitive.Content>
                      </DropdownMenuPrimitive.Portal>
                    </DropdownMenuPrimitive.Root>
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
                    <button
                      type="button"
                      className="rd-session-copy"
                      aria-label={t("copyMessage")}
                      title={t("copyMessage")}
                      onClick={() => {
                        void copyText(msg.content)
                          .then(() => toast.success(t("copied")))
                          .catch(() => toast.error(t("copyFailed")));
                      }}
                    >
                      <Copy size={12} aria-hidden="true" />
                    </button>
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
