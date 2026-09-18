import { useState, type ReactNode } from "react";
import { RefreshCw, ChevronDown, UserRound, LogOut } from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useTranslation } from "react-i18next";
import type { RelayAccountInfo } from "@/lib/api/relay";
import { Sidebar, type Page } from "./Sidebar";
import { Titlebar } from "./Titlebar";
import { Action } from "../ui";
export function AppShell({
  page,
  navigate,
  account,
  busy,
  refreshing,
  refresh,
  logout,
  children,
}: {
  page: Page;
  navigate: (page: Page) => void;
  account: RelayAccountInfo;
  busy: boolean;
  refreshing: boolean;
  refresh: () => void;
  logout: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation("relaydesk");
  const [collapsed, setCollapsed] = useState(false);
  const subtitle =
    page === "models"
      ? "modelSubtitle"
      : page === "targets"
        ? "targetsSubtitle"
        : "settingsSubtitle";
  return (
    <div className="rd-app">
      <Titlebar />
      <div className="rd-workspace">
        <Sidebar
          {...{ page, navigate, account, collapsed }}
          onCollapse={() => setCollapsed(!collapsed)}
        />
        <div className="rd-main">
          <header className="rd-page-header">
            <div>
              <h1>{t(page)}</h1>
              <p>{t(subtitle)}</p>
            </div>
            <div className="rd-header-actions">
              <Action
                onClick={refresh}
                disabled={busy}
                aria-label={t("refresh")}
                title={t("refresh")}
              >
                <RefreshCw size={16} className={refreshing ? "rd-spin" : ""} />
                <span className="rd-refresh-label">
                  {t(refreshing ? "refreshing" : "refresh")}
                </span>
              </Action>
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
          <main key={page} className="rd-content">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
