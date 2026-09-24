import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  CreditCard,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatRelayMoney,
  formatRelayQuota,
  relayApi,
  type RelayAccountInfo,
  type RelayTopupAmountOption,
  type RelayTopupOrder,
  type RelayTopupPaymentMethod,
} from "@/lib/api/relay";
import { Action } from "../ui";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import "./account.css";
import { relayErrorKey } from "../state/relayErrors";

function formatDate(value: string | number | undefined, language: string) {
  if (value === undefined || value === null || value === 0) return "—";
  if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
  const date = new Date(
    typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value,
  );
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function normalizeAmount(
  option: RelayTopupAmountOption | number,
): RelayTopupAmountOption {
  return typeof option === "number" ? { amount: option } : option;
}

function orderLabel(order: RelayTopupOrder) {
  const value = order.tradeNo ?? order.orderId;
  if (!value) return "—";
  if (value.length <= 16) return value;
  return `${value.slice(0, 7)}…${value.slice(-5)}`;
}

function statusLabel(
  status: RelayTopupOrder["status"],
  t: (key: string) => string,
) {
  return t(`topupStatus_${status}`);
}

export function WalletPage({
  account,
  refreshAccount,
  onSessionExpired,
}: {
  account: RelayAccountInfo;
  refreshAccount?: () => Promise<boolean>;
  onSessionExpired?: (error: unknown) => void;
}) {
  const { t, i18n } = useTranslation("relaydesk");
  const [confirmPay, setConfirmPay] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<RelayTopupOrder | null>(
    null,
  );
  const payLock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refreshLock = useRef(false);
  const [checking, setChecking] = useState(false);
  const [balanceStatus, setBalanceStatus] = useState<
    "idle" | "updated" | "failed"
  >("idle");
  const [orderCheckFailed, setOrderCheckFailed] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [externalOpenFailed, setExternalOpenFailed] = useState(false);
  const expiredNotified = useRef(false);
  const notifySessionExpired = useCallback(
    (error: unknown) => {
      if (
        !onSessionExpired ||
        relayErrorKey(error) !== "expired" ||
        expiredNotified.current
      )
        return;
      expiredNotified.current = true;
      onSessionExpired(error);
    },
    [onSessionExpired],
  );
  const openOfficialTopup = () => {
    setExternalOpenFailed(false);
    void relayApi.openOfficialTopup().catch(() => {
      setExternalOpenFailed(true);
    });
  };
  const info = useQuery({
    queryKey: ["relaydesk", "topup-info"],
    queryFn: relayApi.getTopupInfo,
    retry: false,
    staleTime: 60_000,
  });
  const history = useQuery({
    queryKey: ["relaydesk", "topup-history", historyPage],
    queryFn: () => relayApi.listTopupHistory(historyPage, 20),
    retry: false,
    staleTime: 15_000,
  });
  const options = useMemo(
    () => (info.data?.amountOptions ?? []).map(normalizeAmount),
    [info.data?.amountOptions],
  );
  const methods = useMemo(
    () => (info.data?.payMethods ?? []).filter((item) => item.enabled),
    [info.data?.payMethods],
  );
  const activeAmount = amount ?? options[0]?.amount ?? null;
  const activeMethod = method ?? methods[0]?.id ?? null;
  const quote = useQuery({
    queryKey: ["relaydesk", "topup-quote", activeMethod, activeAmount],
    queryFn: () => relayApi.calculateTopupAmount(activeMethod!, activeAmount!),
    enabled: Boolean(
      info.data?.enabled && activeMethod && activeAmount !== null,
    ),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    const error = [info.error, history.error, quote.error].find(
      (candidate) => candidate && relayErrorKey(candidate) === "expired",
    );
    if (error) notifySessionExpired(error);
  }, [info.error, history.error, quote.error, notifySessionExpired]);

  async function refreshWallet() {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setChecking(true);
    setOrderCheckFailed(false);
    setBalanceStatus("idle");
    try {
      const results = await Promise.allSettled([
        historyPage === 1
          ? history.refetch().then((result) => {
              if (result.isError) throw result.error;
              return result.data ?? null;
            })
          : createdOrder
            ? relayApi.listTopupHistory(1, 20)
            : Promise.resolve(null),
        refreshAccount ? refreshAccount() : Promise.resolve(false),
        historyPage !== 1 ? history.refetch() : Promise.resolve(),
        info.refetch(),
        activeAmount !== null && activeMethod
          ? quote.refetch()
          : Promise.resolve(),
      ]);
      if (!mounted.current) return;
      const queryError = (result: (typeof results)[number]) => {
        if (result.status === "rejected") return result.reason;
        const value = result.value as {
          isError?: boolean;
          error?: unknown;
        };
        return value?.isError ? value.error : undefined;
      };
      const expiredError = results
        .map(queryError)
        .find((candidate) => relayErrorKey(candidate) === "expired");
      if (expiredError) {
        notifySessionExpired(expiredError);
        return;
      }
      const [orders, balance] = results;
      if (createdOrder) {
        if (orders.status === "fulfilled" && orders.value) {
          const matched = orders.value.items.find(
            (order) =>
              (createdOrder.tradeNo &&
                order.tradeNo === createdOrder.tradeNo) ||
              (createdOrder.orderId && order.orderId === createdOrder.orderId),
          );
          if (matched) setCreatedOrder(matched);
          else setOrderCheckFailed(true);
        } else setOrderCheckFailed(true);
      }
      if (refreshAccount)
        setBalanceStatus(
          balance.status === "fulfilled" && balance.value
            ? "updated"
            : "failed",
        );
    } finally {
      refreshLock.current = false;
      setChecking(false);
    }
  }

  async function pay() {
    if (payLock.current || activeAmount === null || !activeMethod) return;
    payLock.current = true;
    setPayBusy(true);
    setPayError(false);
    try {
      const order = await relayApi.createTopupPayment(
        activeMethod,
        activeAmount,
        crypto.randomUUID(),
      );
      if (!mounted.current) return;
      setCreatedOrder(order);
      setConfirmPay(false);
      void history.refetch();
    } catch (error) {
      if (!mounted.current) return;
      if (relayErrorKey(error) === "expired") {
        notifySessionExpired(error);
        return;
      }
      setPayError(true);
    } finally {
      payLock.current = false;
      setPayBusy(false);
    }
  }
  return (
    <div className="rd-account-page rd-wallet-page">
      {balanceStatus === "failed" && (
        <p role="alert" className="rd-alert warning">
          {t("walletBalanceRefreshFailed")}
        </p>
      )}
      <Dialog
        open={confirmPay}
        onOpenChange={(open) => {
          if (!payBusy) setConfirmPay(open);
        }}
      >
        <DialogContent className="rd-dialog">
          <DialogTitle>{t("topupConfirmTitle")}</DialogTitle>
          <DialogDescription>{t("topupConfirmHint")}</DialogDescription>
          <p>
            {t("topupAmount")}: {activeAmount} ·{" "}
            {methods.find((item) => item.id === activeMethod)?.label ??
              activeMethod}
          </p>
          <p>
            {t("topupPayAmount")}:{" "}
            {formatRelayMoney(quote.data?.payAmount ?? "—", {
              currencySymbol: account.currencySymbol,
            })}
          </p>
          {payError && <p role="alert">{t("topupCheckoutFailed")}</p>}
          <Action disabled={payBusy} onClick={() => setConfirmPay(false)}>
            {t("cancel")}
          </Action>
          <Action
            primary
            disabled={
              payBusy ||
              payError ||
              quote.isFetching ||
              quote.data?.payAmount === undefined
            }
            onClick={() => void pay()}
          >
            {t(payBusy ? "topupCreating" : "topupPayNow")}
          </Action>
        </DialogContent>
      </Dialog>
      <section className="rd-account-summary" aria-label={t("account")}>
        <div className="rd-account-summary-card rd-account-summary-balance">
          <WalletCards size={18} />
          <span>{t("walletBalance")}</span>
          <strong>{formatRelayQuota(account.quota, account)}</strong>
        </div>
        <div className="rd-account-summary-card">
          <CreditCard size={18} />
          <span>{t("walletSpent")}</span>
          <strong>{formatRelayQuota(account.usedQuota, account)}</strong>
        </div>
        <div className="rd-account-summary-card">
          <Clock3 size={18} />
          <span>{t("walletUpdated")}</span>
          <strong className="rd-account-summary-date">
            {formatDate(account.updatedAt, i18n.language)}
          </strong>
        </div>
      </section>

      <section className="rd-account-card rd-wallet-topup">
        <div className="rd-account-section-heading">
          <div>
            <h2>{t("topup")}</h2>
            <p className="rd-topup-intro">{t("topupIntro")}</p>
          </div>
          <div className="rd-wallet-refresh">
            <Action
              disabled={
                checking || info.isFetching || history.isFetching || payBusy
              }
              onClick={() => void refreshWallet()}
            >
              <RefreshCw size={15} className={checking ? "rd-spin" : ""} />
              {t(checking ? "refreshing" : "usageRefresh")}
            </Action>
          </div>
        </div>
        {info.isPending ? (
          <p className="rd-account-loading" role="status">
            {t("topupInfoLoading")}
          </p>
        ) : info.isError ? (
          <div className="rd-account-state" role="alert">
            <AlertCircle size={18} />
            <div>
              <h3>{t("topupNotReady")}</h3>
              <p>{t("topupNotReadyHint")}</p>
              <Action onClick={() => void info.refetch()}>
                {t("topupRetry")}
              </Action>
              <Action onClick={openOfficialTopup}>
                {t("topupOpenOfficial")}
              </Action>
              {externalOpenFailed && (
                <p className="rd-danger-text">{t("topupOpenOfficialFailed")}</p>
              )}
            </div>
          </div>
        ) : !info.data?.enabled ? (
          <div className="rd-account-state" role="status">
            <AlertCircle size={18} />
            <div>
              <h3>{t("topupUnavailable")}</h3>
              <p>{info.data?.message || t("topupUnavailableHint")}</p>
              <Action onClick={openOfficialTopup}>
                {t("topupOpenOfficial")}
              </Action>
              {externalOpenFailed && (
                <p className="rd-danger-text">{t("topupOpenOfficialFailed")}</p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="rd-wallet-composer">
              <div className="rd-wallet-form-grid">
                <div>
                  <h3>
                    <span className="rd-step-number" aria-hidden="true">
                      1
                    </span>
                    {t("topupAmount")}
                  </h3>
                  <div
                    className="rd-wallet-choice-list"
                    role="group"
                    aria-label={t("topupAmount")}
                  >
                    {options.length ? (
                      options.map((option) => {
                        const symbol =
                          info.data?.currencySymbol ??
                          account.currencySymbol ??
                          "";
                        const label =
                          option.label ?? `${symbol}${option.amount}`;
                        return (
                          <button
                            key={`${option.amount}-${label}`}
                            type="button"
                            aria-pressed={activeAmount === option.amount}
                            className="rd-wallet-choice"
                            onClick={() => setAmount(option.amount)}
                          >
                            {label}
                          </button>
                        );
                      })
                    ) : (
                      <span className="rd-muted">{t("topupNoMethods")}</span>
                    )}
                  </div>
                </div>
                <div>
                  <h3>
                    <span className="rd-step-number" aria-hidden="true">
                      2
                    </span>
                    {t("topupMethod")}
                  </h3>
                  <div
                    className="rd-wallet-method-list"
                    role="radiogroup"
                    aria-label={t("topupMethod")}
                  >
                    {methods.length ? (
                      methods.map((item: RelayTopupPaymentMethod) => (
                        <label className="rd-wallet-method" key={item.id}>
                          <input
                            type="radio"
                            name="relaydesk-topup-method"
                            value={item.id}
                            checked={activeMethod === item.id}
                            onChange={() => setMethod(item.id)}
                          />
                          <span>
                            <strong>{item.label ?? item.id}</strong>
                            {item.description && (
                              <small>{item.description}</small>
                            )}
                          </span>
                        </label>
                      ))
                    ) : (
                      <span className="rd-muted">{t("topupNoMethods")}</span>
                    )}
                  </div>
                </div>
              </div>
              <aside
                className="rd-wallet-checkout"
                aria-label={t("topupSummary")}
              >
                <div className="rd-wallet-quote" aria-live="polite">
                  <div className="rd-wallet-quote-item">
                    <span>{t("topupSelectedAmount")}</span>
                    <strong>
                      {activeAmount === null
                        ? "—"
                        : `${info.data.currencySymbol ?? account.currencySymbol ?? ""}${activeAmount}`}
                    </strong>
                  </div>
                  <div className="rd-wallet-quote-item is-payable">
                    <span>{t("topupPayAmount")}</span>
                    <strong>
                      {quote.data?.payAmount === undefined
                        ? "—"
                        : formatRelayMoney(quote.data.payAmount, {
                            currencySymbol:
                              quote.data.currencySymbol ??
                              info.data.currencySymbol ??
                              account.currencySymbol,
                            currencyCode:
                              quote.data.currency ?? info.data.currency,
                          })}
                    </strong>
                  </div>
                  <p>
                    {quote.isError
                      ? t("topupQuoteUnavailable")
                      : quote.isFetching
                        ? t("topupQuoteLoading")
                        : t("topupQuotePending")}
                  </p>
                </div>
                <div className="rd-wallet-payment-actions">
                  <Action
                    primary
                    disabled={
                      payBusy ||
                      quote.isFetching ||
                      quote.isError ||
                      quote.data?.payAmount === undefined ||
                      !["wxpay", "alipay"].includes(activeMethod ?? "")
                    }
                    onClick={() => {
                      setPayError(false);
                      setConfirmPay(true);
                    }}
                  >
                    {t("topupPayNow")}
                  </Action>
                  <p className="rd-muted">{t("topupCheckoutHint")}</p>
                </div>
              </aside>
            </div>
            {createdOrder && (
              <div
                role="status"
                className={
                  "rd-wallet-order-feedback " +
                  (createdOrder.status === "credited" ? "is-credited" : "")
                }
              >
                {createdOrder.status === "credited" ? (
                  <CheckCircle2 size={18} aria-hidden="true" />
                ) : (
                  <Clock3 size={18} aria-hidden="true" />
                )}
                <div>
                  <strong>
                    {createdOrder.status === "credited"
                      ? t(
                          balanceStatus === "updated"
                            ? "topupCreditedBalanceUpdated"
                            : "topupCreditedConfirmed",
                        )
                      : ["created", "pending"].includes(createdOrder.status)
                        ? t("topupCheckoutOpened")
                        : statusLabel(createdOrder.status, t)}
                  </strong>
                  <span>
                    {t("topupOrder")}: {orderLabel(createdOrder)}
                  </span>
                  {orderCheckFailed && <p>{t("topupOrderRefreshFailed")}</p>}
                </div>
                <Action
                  disabled={checking || payBusy}
                  onClick={() => void refreshWallet()}
                >
                  {t(checking ? "refreshing" : "topupCheckStatus")}
                </Action>
              </div>
            )}
          </>
        )}
      </section>

      <section className="rd-account-card rd-wallet-orders">
        <div className="rd-account-section-heading">
          <div>
            <span className="rd-section-eyebrow">{t("topup")}</span>
            <h2>{t("topupOrderHistory")}</h2>
          </div>
        </div>
        {history.isPending ? (
          <p className="rd-account-loading" role="status">
            {t("usageLoading")}
          </p>
        ) : history.isError ? (
          <div className="rd-account-state" role="alert">
            <AlertCircle size={18} />
            <div>
              <h3>{t("topupOrderQueryMissing")}</h3>
              <p>{t("topupOrderQueryMissingHint")}</p>
            </div>
          </div>
        ) : history.data?.items.length ? (
          <div
            className="rd-account-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t("topupOrderHistory")}
          >
            <table className="rd-account-table">
              <thead>
                <tr>
                  <th>{t("topupOrder")}</th>
                  <th>{t("topupCreatedAt")}</th>
                  <th>{t("topupPayAmount")}</th>
                  <th>{t("topupCreditAmount")}</th>
                  <th>{t("topupPaymentMethod")}</th>
                  <th>{t("topupStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {history.data.items.map((order, index) => (
                  <tr key={order.orderId ?? order.tradeNo ?? index}>
                    <td
                      className="rd-mono"
                      title={order.tradeNo ?? order.orderId}
                    >
                      {orderLabel(order)}
                    </td>
                    <td>{formatDate(order.createdAt, i18n.language)}</td>
                    <td>
                      {order.payAmount === undefined
                        ? "—"
                        : formatRelayMoney(order.payAmount, {
                            currencySymbol:
                              order.currencySymbol ??
                              info.data?.currencySymbol ??
                              account.currencySymbol,
                            currencyCode: order.currency ?? info.data?.currency,
                          })}
                    </td>
                    <td>
                      {order.creditAmount === undefined
                        ? "—"
                        : formatRelayMoney(order.creditAmount, {
                            currencySymbol:
                              order.currencySymbol ??
                              info.data?.currencySymbol ??
                              account.currencySymbol,
                            currencyCode: order.currency ?? info.data?.currency,
                          })}
                    </td>
                    <td>{order.method ?? "—"}</td>
                    <td>
                      <span className={`rd-order-status ${order.status}`}>
                        {statusLabel(order.status, t)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rd-account-empty">{t("topupNoOrders")}</p>
        )}
        {(history.data?.total ?? 0) > 20 && (
          <div className="rd-usage-toolbar">
            <Action
              disabled={historyPage <= 1 || history.isFetching}
              onClick={() => setHistoryPage((page) => page - 1)}
            >
              {t("previousPage")}
            </Action>
            <span>
              {historyPage} / {Math.ceil((history.data?.total ?? 0) / 20)}
            </span>
            <Action
              disabled={
                historyPage * 20 >= (history.data?.total ?? 0) ||
                history.isFetching
              }
              onClick={() => setHistoryPage((page) => page + 1)}
            >
              {t("nextPage")}
            </Action>
          </div>
        )}
      </section>
    </div>
  );
}
