import { useState } from "react";
import { useTranslation } from "react-i18next";
import "./i18n";
import { Brand } from "./layout/Brand";
import { Titlebar } from "./layout/Titlebar";
import { AppShell } from "./layout/AppShell";
import type { Page } from "./layout/Sidebar";
import { LoginPage } from "./auth/LoginPage";
import { ModelCenterPage } from "./models/ModelCenterPage";
import { ApplyProgressDialog } from "./models/ApplyProgressDialog";
import { TargetsPage } from "./targets/TargetsPage";
import { RelayDeskSettingsPage } from "./settings/RelayDeskSettingsPage";
import { useRelaySession } from "./state/useRelaySession";
import { useRelayApply } from "./state/useRelayApply";
import { Action } from "./ui";
export default function RelayDeskApp() {
  const { t } = useTranslation("relaydesk");
  const session = useRelaySession();
  const operation = useRelayApply(
    session.account,
    session.applied,
    session.handleError,
    session.generation,
  );
  const [page, setPage] = useState<Page>("models");
  const busy = session.busy || operation.pending;
  if (session.accountQuery.isPending && !session.expired)
    return (
      <div className="rd-boot">
        <Titlebar />
        <Brand />
        <div role="status">
          <h1>{t("boot")}</h1>
          <p>{t("bootHint")}</p>
          <div className="rd-boot-skeleton">
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
    );
  if (session.accountQuery.isError && !session.expired)
    return (
      <div className="rd-boot">
        <Titlebar />
        <Brand />
        <div role="alert">
          <h1>{t("initError")}</h1>
          <Action onClick={() => void session.accountQuery.refetch()}>
            {t("retry")}
          </Action>
        </div>
      </div>
    );
  if (!session.account)
    return (
      <LoginPage
        busy={session.busy}
        error={session.error}
        login={async (...args) => {
          await session.login(...args);
          setPage("models");
        }}
      />
    );
  const account = session.account;
  const refresh = () => {
    if (!busy) void session.refresh();
  };
  return (
    <>
      <AppShell
        {...{ page, account, busy, refresh }}
        navigate={setPage}
        refreshing={session.busy}
        logout={() => void session.logout()}
      >
        {session.error && session.error !== "expired" && (
          <div role="alert" className="rd-alert error">
            {t(session.error)}
          </div>
        )}
        {page === "models" && (
          <ModelCenterPage
            account={account}
            models={session.modelsQuery.data ?? []}
            groups={session.groupsQuery.data ?? []}
            loading={session.modelsQuery.isPending}
            fetching={session.modelsQuery.isFetching}
            loadingError={session.modelsQuery.isError}
            busy={busy}
            report={operation.report}
            pending={operation.pending}
            notice={operation.notice}
            refresh={refresh}
            apply={(group, model) => {
              if (!busy) void operation.apply(group, model);
            }}
            details={() => operation.setOpen(true)}
            targets={() => setPage("targets")}
            viewAccount={() => setPage("settings")}
          />
        )}
        {page === "targets" && (
          <TargetsPage
            apps={account.applyApps}
            busy={busy}
            report={operation.report}
            change={(apps) => void session.setApps(apps)}
          />
        )}
        {page === "settings" && (
          <RelayDeskSettingsPage
            {...{ account, busy, refresh }}
            logout={() => void session.logout()}
          />
        )}
      </AppShell>
      <ApplyProgressDialog
        report={operation.report}
        open={operation.open}
        onOpenChange={operation.setOpen}
        pending={operation.pending}
        busy={busy}
        apps={account.applyApps}
        retry={(app) => {
          if (!busy && operation.report)
            void operation.apply(
              operation.report.group,
              operation.report.model,
              app,
            );
        }}
      />
    </>
  );
}
