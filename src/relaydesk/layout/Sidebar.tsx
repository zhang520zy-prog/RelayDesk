import {
  Boxes,
  SlidersHorizontal,
  Settings2,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  Download,
  WalletCards,
  BarChart3,
  MessageSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Brand } from "./Brand";
import { Action } from "../ui";
export type Page =
  | "models"
  | "deployment"
  | "targets"
  | "sessions"
  | "wallet"
  | "usage"
  | "settings"
  | "about";
export function Sidebar({
  page,
  navigate,
  collapsed,
  onCollapse,
}: {
  page: Page;
  navigate: (page: Page) => void;
  collapsed: boolean;
  onCollapse: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const navItems = [
    { id: "deployment" as const, Icon: Download },
    { id: "models" as const, Icon: Boxes },
    { id: "targets" as const, Icon: SlidersHorizontal },
    { id: "sessions" as const, Icon: MessageSquare },
    { id: "wallet" as const, Icon: WalletCards },
    { id: "usage" as const, Icon: BarChart3 },
  ];
  const bottomItems = [
    { id: "settings" as const, Icon: Settings2 },
    { id: "about" as const, Icon: Info },
  ];
  const item = ({
    id,
    Icon,
  }: {
    id: Page;
    Icon: (typeof navItems)[number]["Icon"];
  }) => (
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
  );
  return (
    <aside className={`rd-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <Brand compact={collapsed} />
      {!collapsed && <p className="rd-nav-label">{t("workspace")}</p>}
      <nav aria-label="RelayDesk" className="rd-sidebar-nav">
        {navItems.map(item)}
      </nav>
      <div className="rd-sidebar-bottom">
        <div
          className="rd-sidebar-divider"
          role="separator"
          aria-hidden="true"
        />
        {bottomItems.map(item)}
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
