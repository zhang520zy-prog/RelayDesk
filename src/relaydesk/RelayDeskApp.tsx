import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import "./i18n";
import { relayApi, type RelayTarget } from "@/lib/api/relay";
import { settingsApi } from "@/lib/api/settings";
import { Brand } from "./layout/Brand";
import { Titlebar } from "./layout/Titlebar";
import { AppShell } from "./layout/AppShell";
import type { Page } from "./layout/Sidebar";
import { UpdateBanner, type UpdateBannerStatus } from "./layout/UpdateBanner";
import { LoginPage } from "./auth/LoginPage";
import { ApplyProgressDialog } from "./models/ApplyProgressDialog";
import { useRelaySession } from "./state/useRelaySession";
import { useRelayApply } from "./state/useRelayApply";
import { Action } from "./ui";
import { RestartToolsAction } from "./models/RestartToolsAction";
import { relayErrorKey } from "./state/relayErrors";

// 页面级按需加载：首屏只带登录/骨架，进入哪个页面再取哪个 chunk。
const ModelCenterPage = lazy(() =>
  import("./models/ModelCenterPage").then((m) => ({
    default: m.ModelCenterPage,
  })),
);
const TargetsPage = lazy(() =>
  import("./targets/TargetsPage").then((m) => ({ default: m.TargetsPage })),
);
const SessionsPage = lazy(() =>
  import("./sessions/SessionsPage").then((m) => ({ default: m.SessionsPage })),
);
const EnvironmentPage = lazy(() =>
  import("./environment/EnvironmentPage").then((m) => ({
    default: m.EnvironmentPage,
  })),
);
const WalletPage = lazy(() =>
  import("./account/WalletPage").then((m) => ({ default: m.WalletPage })),
);
const UsagePage = lazy(() =>
  import("./account/UsagePage").then((m) => ({ default: m.UsagePage })),
);
const RelayDeskSettingsPage = lazy(() =>
  import("./settings/RelayDeskSettingsPage").then((m) => ({
    default: m.RelayDeskSettingsPage,
  })),
);

const UPDATE_DISMISS_KEY = "relaydesk.update.dismissedVersion";

function PageFallback() {
  return (
    <div className="rd-page-loading" role="status" aria-live="polite">
      <span className="rd-boot-skeleton">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

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
  const [focusTarget, setFocusTarget] = useState<RelayTarget | null>(null);
  const [guestEnvironment, setGuestEnvironment] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateBannerStatus>({
    kind: "idle",
  });
  // 用户在检查途中点"忽略"时，晚到的结果不得把横幅重新弹出来。
  // 自动检查尊重按版本持久化的忽略；手动"重试/检查"总是展示结果。
  const applyCheckResult = (
    result: Awaited<ReturnType<typeof relayApi.checkUpdate>>,
    manual = false,
  ) =>
    setUpdateStatus((current) => {
      if (current.kind === "idle") return current;
      if (!result.configured) return { kind: "not_configured" };
      if (!result.version) return { kind: "latest" };
      if (!manual) {
        try {
          if (localStorage.getItem(UPDATE_DISMISS_KEY) === result.version)
            return { kind: "idle" };
        } catch {
          // localStorage 不可用时按未忽略处理
        }
      }
      return { kind: "available", version: result.version };
    });
  const applyCheckFailure = () =>
    setUpdateStatus((current) =>
      current.kind === "idle" ? current : { kind: "check_failed" },
    );
  const checkUpdate = () => {
    setUpdateStatus({ kind: "checking" });
    void relayApi
      .checkUpdate()
      .then((result) => applyCheckResult(result, true))
      .catch(applyCheckFailure);
  };
  const dismissUpdate = () =>
    setUpdateStatus((current) => {
      if (current.kind === "available") {
        try {
          localStorage.setItem(UPDATE_DISMISS_KEY, current.version);
        } catch {
          // 存储失败不影响本次忽略
        }
      }
      return { kind: "idle" };
    });
  const installUpdate = () => {
    setUpdateStatus({ kind: "installing" });
    void settingsApi.installUpdateAndRestart().catch(() => {
      setUpdateStatus((current) =>
        current.kind === "idle" ? current : { kind: "install_failed" },
      );
    });
  };
  const updateCheckedFor = useRef<string | null>(null);
  useEffect(() => {
    const acct = session.account;
    if (!acct) {
      updateCheckedFor.current = null;
      return;
    }
    // account 对象每次 refetch 都是新引用；用 username 做登录身份去重，
    // 保证每个登录会话只自动检查一次。
    if (updateCheckedFor.current === acct.username) return;
    updateCheckedFor.current = acct.username;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setUpdateStatus({ kind: "checking" });
      void relayApi
        .checkUpdate()
        .then((result) => {
          if (!cancelled) applyCheckResult(result);
        })
        .catch(() => {
          if (!cancelled) applyCheckFailure();
        });
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // 每个登录会话只检查一次，避免页面切换重复打更新端点。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.account]);
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
          openEnvironment={() => setGuestEnvironment(true)}
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
  if (!session.account) {
    if (guestEnvironment)
      return (
        <div className="rd-guest-env">
          <Titlebar />
          <Suspense fallback={<PageFallback />}>
            <EnvironmentPage
              busy={false}
              onBack={() => setGuestEnvironment(false)}
            />
          </Suspense>
        </div>
      );
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
        openEnvironment={() => setGuestEnvironment(true)}
        login={async (...args) => {
          await session.login(...args);
          setPage("models");
          setShowEnvironmentIntro(true);
        }}
      />
    );
  }
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
        <UpdateBanner
          status={updateStatus}
          onCheck={checkUpdate}
          onInstall={installUpdate}
          onDismiss={dismissUpdate}
          onOpenSettings={() => setPage("settings")}
        />
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
        <Suspense fallback={<PageFallback />}>
          {page === "models" && (
            <ModelCenterPage
              filters={
                modelFilters.epoch === session.generation.current
                  ? modelFilters
                  : { search: "", group: "" }
              }
              onFiltersChange={(filters) =>
                setModelFilters({
                  ...filters,
                  epoch: session.generation.current,
                })
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
              targets={(app) => {
                setPage("targets");
                setFocusTarget(app ?? null);
              }}
              viewAccount={() => setPage("settings")}
              viewWallet={() => setPage("wallet")}
            />
          )}
          {page === "targets" && (
            <TargetsPage
              focusTarget={focusTarget}
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
          {page === "sessions" && <SessionsPage />}
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
        </Suspense>
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
