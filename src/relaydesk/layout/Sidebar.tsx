import {
  Boxes,
  SlidersHorizontal,
  Settings2,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUpRight,
  Download,
  WalletCards,
  BarChart3,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatRelayQuota, type RelayAccountInfo } from "@/lib/api/relay";
import { Brand } from "./Brand";
import { Action } from "../ui";
export type Page =
  | "models"
  | "deployment"
  | "targets"
  | "wallet"
  | "usage"
  | "settings";
export function Sidebar({
  page,
  navigate,
  account,
  collapsed,
  onCollapse,
}: {
  page: Page;
  navigate: (page: Page) => void;
  account: RelayAccountInfo;
  collapsed: boolean;
  onCollapse: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  return (
    <aside className={`rd-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <Brand compact={collapsed} />
      {!collapsed && <p className="rd-nav-label">{t("workspace")}</p>}
      <nav aria-label="RelayDesk" className="rd-sidebar-nav">
        {(
          [
            { id: "models", Icon: Boxes },
            { id: "deployment", Icon: Download },
            { id: "targets", Icon: SlidersHorizontal },
            { id: "wallet", Icon: WalletCards },
            { id: "usage", Icon: BarChart3 },
          ] as const
        ).map(({ id, Icon }) => (
          <button
            key={id}
            className={`rd-nav-item ${page === id ? "is-active" : ""}`}
            aria-current={page === id ? "page" : undefined}
            aria-label={t(id)}
            title={collapsed ? t(id) : undefined}
            onClick={() => navigate(id)}
          >
            <span className="rd-nav-content">
              <Icon size={19} aria-hidden="true" />
              {!collapsed && <span>{t(id)}</span>}
            </span>
          </button>
        ))}
      </nav>
      <div className="rd-sidebar-bottom">
        <button
          className={`rd-nav-item ${page === "settings" ? "is-active" : ""}`}
          aria-label={t("settings")}
          aria-current={page === "settings" ? "page" : undefined}
          onClick={() => navigate("settings")}
        >
          <Settings2 size={18} />
          {!collapsed && <span>{t("settings")}</span>}
        </button>
        {!collapsed && (
          <button
            className="rd-account-card"
            onClick={() => navigate("settings")}
            aria-label={t("viewAccount")}
          >
            <div>
              <span className="rd-avatar">
                {account.username.slice(0, 1).toUpperCase()}
              </span>
              <span className="rd-account-name">{account.username}</span>
              <ArrowUpRight size={14} />
            </div>
            <small>{t("balance")}</small>
            <strong>{formatRelayQuota(account.quota, account)}</strong>
            <span className="rd-muted rd-account-status">
              <i className="rd-dot" />
              {t("secureSession")}
            </span>
          </button>
        )}
        <Action
          className="rd-collapse"
          aria-label={t(collapsed ? "expand" : "collapse")}
          title={t(collapsed ? "expand" : "collapse")}
          onClick={onCollapse}
        >
          {collapsed ? (
            <PanelLeftOpen size={17} />
          ) : (
            <>
              <PanelLeftClose size={17} />
              <span>{t("collapse")}</span>
            </>
          )}
        </Action>
      </div>
    </aside>
  );
}
