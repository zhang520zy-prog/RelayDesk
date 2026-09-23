import { useEffect, useRef, type ReactNode } from "react";
import { RefreshCw, ChevronDown, UserRound, LogOut } from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useTranslation } from "react-i18next";
import type { RelayAccountInfo } from "@/lib/api/relay";
import { Sidebar, type Page } from "./Sidebar";
import { Titlebar } from "./Titlebar";
import { useViewPreference } from "../state/useViewPreference";
import { Action } from "../ui";
export function AppShell({
  page,
  navigate,
  account,
  busy,
  refreshing,
  refresh,
  logout,
  modelActions,
  children,
}: {
  page: Page;
  navigate: (page: Page) => void;
  account: RelayAccountInfo;
  busy: boolean;
  refreshing: boolean;
  refresh: () => void;
  logout: () => void;
  modelActions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation("relaydesk");
  const [sidebar, setSidebar] = useViewPreference("sidebar", "expanded", [
    "expanded",
    "collapsed",
  ]);
  const collapsed = sidebar === "collapsed";
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLElement>(null);
  const previousPage = useRef(page);
  useEffect(() => {
    if (previousPage.current !== page) {
      heading.current?.focus({ preventScroll: true });
      content.current?.scrollTo?.(0, 0);
      previousPage.current = page;
    }
  }, [page]);
  const subtitle =
    page === "models"
      ? "modelSubtitle"
      : page === "deployment"
        ? "deploymentSubtitle"
        : page === "targets"
          ? "targetsSubtitle"
          : page === "wallet"
            ? "walletSubtitle"
            : page === "usage"
              ? "usageSubtitle"
              : "settingsSubtitle";
  return (
    <div className="rd-app">
      <Titlebar />
      <a
        className="rd-skip-link"
        href="#rd-main-content"
        onClick={(event) => {
          event.preventDefault();
          content.current?.focus();
        }}
      >
        {t("skipToContent")}
      </a>
      <div className="rd-workspace">
        <Sidebar
          {...{ page, navigate, account, collapsed }}
          onCollapse={() => setSidebar(collapsed ? "expanded" : "collapsed")}
        />
        <div className="rd-main">
          <header className="rd-page-header">
            <div>
              <h1 ref={heading} tabIndex={-1}>
                {t(page)}
              </h1>
              <p>{t(subtitle)}</p>
            </div>
            <div className="rd-header-actions">
              {page === "models" && modelActions}
              {(page === "models" ||
                page === "targets" ||
                page === "settings") && (
                <Action
                  onClick={refresh}
                  disabled={busy}
                  aria-label={t("refreshData")}
                  title={t("refreshDataHint")}
                >
                  <RefreshCw
                    size={16}
                    className={refreshing ? "rd-spin" : ""}
                  />
                  <span className="rd-refresh-label">
                    {t(refreshing ? "refreshing" : "refreshData")}
                  </span>
                </Action>
              )}
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Action aria-label={t("accountMenu")}>
                    <UserRound size={16} />
                    <ChevronDown size={13} />
                  </Action>
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content className="rd-menu" align="end" sideOffset={8}>
                    <Menu.Label className="rd-menu-label">
                      {account.username}
                    </Menu.Label>
                    <Menu.Item onSelect={() => navigate("settings")}>
                      <UserRound size={15} />
                      {t("viewAccount")}
                    </Menu.Item>
                    <Menu.Item disabled={busy} onSelect={logout}>
                      <LogOut size={15} />
                      {t("logout")}
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu.Root>
            </div>
          </header>
          <main
            key={page}
            ref={content}
            id="rd-main-content"
            tabIndex={-1}
            className="rd-content"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
