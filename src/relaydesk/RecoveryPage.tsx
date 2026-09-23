import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Brand } from "./layout/Brand";
import { Titlebar } from "./layout/Titlebar";
import { Action } from "./ui";
import { settingsApi } from "@/lib/api/settings";
import { exit } from "@tauri-apps/plugin-process";
export function RecoveryPage() {
  const { t } = useTranslation("relaydesk");
  const [error, setError] = useState(false);
  return (
    <div className="rd-boot">
      <Titlebar />
      <Brand />
      <div role="alert">
        <h1>{t("recoveryTitle")}</h1>
        <p>{t("recoveryBody")}</p>
        <div className="rd-setting-actions">
          <Action
            onClick={() =>
              void settingsApi.openAppConfigFolder().catch(() => setError(true))
            }
          >
            {t("openData")}
          </Action>
          <Action onClick={() => window.location.reload()}>{t("retry")}</Action>
          <Action onClick={() => void exit(0)}>{t("close")}</Action>
        </div>
        {error && <p>{t("genericError")}</p>}
      </div>
    </div>
  );
}
