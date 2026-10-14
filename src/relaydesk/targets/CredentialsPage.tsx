import { useTranslation } from "react-i18next";
import { Info, RefreshCw } from "lucide-react";
import { ApiKeysSection } from "./ApiKeysSection";
import type { RelayGroup } from "@/lib/api/relay";

/** 通用接入凭据独立页：给 CherryStudio / WorkBuddy 这类
 *  只需要 Base URL + API Key 的客户端提供凭据管理。 */
export function CredentialsPage({
  baseUrl,
  groups,
  loading,
  loadError,
  refresh,
}: {
  baseUrl: string;
  groups: RelayGroup[];
  loading: boolean;
  loadError: boolean;
  refresh: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  return (
    <div className="rd-targets-page">
      <div className="rd-page-kicker">
        <span className="rd-status idle">
          <i className="rd-dot" />
          {t("apiKeysTagline")}
        </span>
        {loadError && (
          <button className="rd-link" onClick={refresh}>
            <RefreshCw size={13} />
            {t("credentialsGroupsFailed")}
          </button>
        )}
      </div>
      <ApiKeysSection baseUrl={baseUrl} groups={groups} loading={loading} />
      <p className="rd-info-note">
        <Info size={17} />
        {t("credentialsNotice")}
      </p>
    </div>
  );
}
