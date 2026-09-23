import { useEffect, useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import "./i18n";
import { relayApi } from "@/lib/api/relay";
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
import { EnvironmentPage } from "./environment/EnvironmentPage";
import { RestartToolsAction } from "./models/RestartToolsAction";
import { WalletPage } from "./account/WalletPage";
import { UsagePage } from "./account/UsagePage";
import { relayErrorKey } from "./state/relayErrors";
export default function RelayDeskApp() {
  const { t } = useTranslation("relaydesk");
  // 未捕获的前端错误落应用日志：现场用户无需任何操作，导出诊断即包含。
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const location = event.filename
        ? ` @ ${event.filename}:${event.lineno ?? 0}`
        : "";
      void relayApi
        .logFrontendError(`window error: ${event.message}${location}`)
        .catch(() => {});
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? `${event.reason.name}: ${event.reason.message}`
          : String(event.reason);
      void relayApi
        .logFrontendError(`unhandled rejection: ${reason}`)
        .catch(() => {});
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  const session = useRelaySession();
  const operation = useRelayApply(
    session.account,
    session.applied,
    session.handleError,
    session.generation,
  );
  const [page, setPage] = useState<Page>("models");
  const [modelFilters, setModelFilters] = useState({
    epoch: -1,
    search: "",
    group: "",
  });
  const [showEnvironmentIntro, setShowEnvironmentIntro] = useState(false);
  const installing =
    useIsMutating({ mutationKey: ["relaydesk", "tool-install"] }) > 0;
  const busy =
    session.busy ||
    !!session.groupTargetSaving ||
    operation.pending ||
    installing;
  const openEnvironment = () => {
    operation.setOpen(false);
    setPage("deployment");
    setShowEnvironmentIntro(false);
  };
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
  if (session.accountQuery.isError && !session.expired) {
    const restoreError = relayErrorKey(session.accountQuery.error);
    if (restoreError) {
      return (
        <LoginPage
          busy={session.busy}
          error={session.error ?? restoreError}
          savedLogins={session.savedLoginQuery.data ?? []}
          savedLoginsLoading={session.savedLoginQuery.isPending}
          loginSaved={async (savedId) => {
            await session.loginSaved(savedId);
            setPage("models");
          }}
          forgetSavedLogin={session.forgetSavedLogin}
          login={async (...args) => {
            await session.login(...args);
            setPage("models");
            setShowEnvironmentIntro(true);
          }}
        />
      );
    }
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
  }
  if (!session.account)
    return (
      <LoginPage
        busy={session.busy}
        error={session.error}
        savedLogins={session.savedLoginQuery.data ?? []}
        savedLoginsLoading={session.savedLoginQuery.isPending}
        loginSaved={async (savedId) => {
          await session.loginSaved(savedId);
          setPage("models");
        }}
        forgetSavedLogin={session.forgetSavedLogin}
        login={async (...args) => {
          await session.login(...args);
          setPage("models");
          setShowEnvironmentIntro(true);
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
        navigate={(next) => {
          setPage(next);
          if (next === "deployment") setShowEnvironmentIntro(false);
        }}
        refreshing={session.busy}
        modelActions={
          <RestartToolsAction
            report={operation.report}
            pending={operation.pending}
            openDeployment={openEnvironment}
          />
        }
        logout={() => void session.logout()}
      >
        {showEnvironmentIntro && (
          <div className="rd-environment-onboarding">
            <span>{t("environmentOnboarding")}</span>
            <Action onClick={openEnvironment}>{t("openEnvironment")}</Action>
            <button
              className="rd-text-button"
              onClick={() => setShowEnvironmentIntro(false)}
            >
              {t("dismissEnvironment")}
            </button>
          </div>
        )}
        {session.error && session.error !== "expired" && (
          <div
            role="alert"
            className={
              session.error === "rememberNotSaved"
                ? "rd-alert warning"
                : "rd-alert error"
            }
          >
            {t(session.error)}
          </div>
        )}
        {page === "models" && (
          <ModelCenterPage
            filters={
              modelFilters.epoch === session.generation.current
                ? modelFilters
                : { search: "", group: "" }
            }
            onFiltersChange={(filters) =>
              setModelFilters({ ...filters, epoch: session.generation.current })
            }
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
            viewWallet={() => setPage("wallet")}
          />
        )}
        {page === "targets" && (
          <TargetsPage
            apps={account.applyApps}
            groups={session.groupsQuery.data ?? []}
            groupTargets={account.groupTargets ?? {}}
            groupsLoading={session.groupsQuery.isPending}
            groupsError={session.groupsQuery.isError}
            refreshGroups={() => void session.groupsQuery.refetch()}
            routingBusy={session.busy || operation.pending || installing}
            busy={busy}
            report={operation.report}
            change={(apps) => void session.setApps(apps)}
            changeGroupTarget={session.setGroupTarget}
          />
        )}
        {page === "deployment" && (
          <EnvironmentPage busy={busy} onBack={() => setPage("models")} />
        )}
        {page === "settings" && (
          <RelayDeskSettingsPage
            {...{ account, busy, refresh }}
            logout={() => void session.logout()}
          />
        )}
        {page === "wallet" && (
          <WalletPage
            account={account}
            refreshAccount={session.refreshAccount}
            onSessionExpired={session.handleError}
          />
        )}
        {page === "usage" && (
          <UsagePage
            account={session.account}
            onSessionExpired={session.handleError}
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
        openEnvironment={openEnvironment}
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
