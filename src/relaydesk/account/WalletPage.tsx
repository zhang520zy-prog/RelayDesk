import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
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
  type RelayRechargeRecord,
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

/** 预设档位与站点收银台一致：仅此五档 + 自定义金额 */
const PRESET_AMOUNTS = [10, 25, 50, 100, 200] as const;

/** 折扣徽标百分比：优先站点给的 discount 率，否则由 creditAmount 反推。
 *  无优惠信息返回 null（不显示徽标，不虚构折扣）。 */
function discountPct(option: RelayTopupAmountOption): number | null {
  if (option.discount != null && option.discount > 0 && option.discount < 1)
    return Math.round((1 - option.discount) * 100);
  if (option.creditAmount != null && option.creditAmount > option.amount)
    return Math.round(
      ((option.creditAmount - option.amount) / option.creditAmount) * 100,
    );
  return null;
}

function orderLabel(refId: string) {
  if (!refId) return "—";
  if (refId.length <= 16) return refId;
  return `${refId.slice(0, 7)}…${refId.slice(-5)}`;
}

function statusLabel(
  status: RelayRechargeRecord["status"],
  t: (key: string) => string,
) {
  return t(`topupStatus_${status}`);
}

/** 充值方式：已知 id 走本地化，未知原样显示 */
function methodLabel(method: string | undefined, t: (key: string) => string) {
  if (!method) return "—";
  const known = ["wxpay", "alipay", "redeem", "admin", "stripe", "epay"];
  return known.includes(method) ? t(`topupMethod_${method}`) : method;
}

/** 支付方式品牌图标（微信绿标 / 支付宝蓝标），未知方式回退通用卡标 */
function MethodIcon({ id }: { id: string }) {
  if (id === "wxpay")
    return (
      <svg
        className="rd-pay-icon"
        viewBox="0 0 24 24"
        width={22}
        height={22}
        aria-hidden="true"
      >
        <rect width="24" height="24" rx="5.5" fill="#09bb07" />
        <path
          fill="#fff"
          d="M9.6 5.6c-3 0-5.4 2-5.4 4.5 0 1.4.8 2.7 2 3.5l-.5 1.7 2-1.1c.5.2 1.2.3 1.9.3h.4a4.7 4.7 0 0 1-.2-1.3c0-2.6 2.5-4.7 5.5-4.7h.3C15 6.8 12.5 5.6 9.6 5.6Zm-2.1 2.4a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6Zm4.3 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6Zm8.5 5.2c0-2.3-2.3-4.1-5-4.1s-5 1.8-5 4.1 2.2 4.2 5 4.2c.6 0 1.2-.1 1.7-.3l1.7.9-.5-1.5c1.2-.7 2.1-1.9 2.1-3.3Zm-6.7-.7a.7.7 0 1 1 0-1.4.7.7 0 0 1 0 1.4Zm3.4 0a.7.7 0 1 1 0-1.4.7.7 0 0 1 0 1.4Z"
        />
      </svg>
    );
  if (id === "alipay")
    return (
      <svg
        className="rd-pay-icon"
        viewBox="0 0 24 24"
        width={22}
        height={22}
        aria-hidden="true"
      >
        {/* 官方「支」字蓝底标（simple-icons 路径，含圆角底） */}
        <path
          fill="#1677ff"
          d="M19.695 15.07c3.426 1.158 4.203 1.22 4.203 1.22V3.846c0-2.124-1.705-3.845-3.81-3.845H3.914C1.808.001.102 1.722.102 3.846v16.31c0 2.123 1.706 3.845 3.813 3.845h16.173c2.105 0 3.81-1.722 3.81-3.845v-.157s-6.19-2.602-9.315-4.119c-2.096 2.602-4.8 4.181-7.607 4.181-4.75 0-6.361-4.19-4.112-6.949.49-.602 1.324-1.175 2.617-1.497 2.025-.502 5.247.313 8.266 1.317a16.796 16.796 0 0 0 1.341-3.302H5.781v-.952h4.799V6.975H4.77v-.953h5.81V3.591s0-.409.411-.409h2.347v2.84h5.744v.951h-5.744v1.704h4.69a19.453 19.453 0 0 1-1.986 5.06c1.424.52 2.702 1.011 3.654 1.333m-13.81-2.032c-.596.06-1.71.325-2.321.869-1.83 1.608-.735 4.55 2.968 4.55 2.151 0 4.301-1.388 5.99-3.61-2.403-1.182-4.438-2.028-6.637-1.809"
        />
      </svg>
    );
  return (
    <span className="rd-pay-icon rd-pay-icon--generic" aria-hidden="true">
      <CreditCard size={16} />
    </span>
  );
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
  const [customAmount, setCustomAmount] = useState("");
  const [redeemKey, setRedeemKey] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemResult, setRedeemResult] = useState<
    { ok: true; credited: number | null } | { ok: false; key: string } | null
  >(null);
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
    queryKey: ["relaydesk", "recharge-history", historyPage],
    queryFn: () => relayApi.listRechargeHistory(historyPage, 20),
    retry: false,
    staleTime: 15_000,
  });
  const options = useMemo(() => {
    const offered = (info.data?.amountOptions ?? []).map(normalizeAmount);
    // 固定五档为主列表：站点返回的档位信息（优惠/标签）按 amount 合并进来
    return PRESET_AMOUNTS.map(
      (amount) =>
        offered.find((option) => option.amount === amount) ?? {
          amount: amount as number,
        },
    );
  }, [info.data?.amountOptions]);
  const methods = useMemo(
    () => (info.data?.payMethods ?? []).filter((item) => item.enabled),
    [info.data?.payMethods],
  );
  const minAmount = info.data?.minAmount ?? 1;
  const customValue = Number(customAmount);
  const customValid =
    customAmount.trim() !== "" &&
    Number.isInteger(customValue) &&
    customValue >= minAmount;
  // 自定义金额填了就用它（非法则置空阻断支付）；否则用预设档
  const activeAmount =
    customAmount.trim() !== ""
      ? customValid
        ? customValue
        : null
      : (amount ?? options[0]?.amount ?? null);
  const activeMethod = method ?? methods[0]?.id ?? null;
  // 逐档真实报价：站点收银台的"实付/省 X%"来自服务端按金额+支付方式
  // 计算的 quote，而不是 amount_options 里的静态字段——金额选项常是裸
  // 数字数组，缺 discount 字段时徽标全灭，跟站点显示对不上。
  const presetQuotes = useQueries({
    queries: PRESET_AMOUNTS.map((preset) => ({
      queryKey: ["relaydesk", "topup-quote", activeMethod, preset],
      queryFn: () => relayApi.calculateTopupAmount(activeMethod!, preset),
      enabled: Boolean(info.data?.enabled && activeMethod),
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    })),
  });
  const presetQuoteMap = useMemo(() => {
    const map = new Map<number, number | undefined>();
    PRESET_AMOUNTS.forEach((preset, i) => {
      map.set(preset, presetQuotes[i]?.data?.payAmount);
    });
    return map;
  }, [presetQuotes]);
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
    const candidates = [
      info.error,
      history.error,
      quote.error,
      ...presetQuotes.map((q) => q.error),
    ];
    const error = candidates.find(
      (candidate) => candidate && relayErrorKey(candidate) === "expired",
    );
    if (error) notifySessionExpired(error);
  }, [
    info.error,
    history.error,
    quote.error,
    presetQuotes,
    notifySessionExpired,
  ]);

  async function refreshWallet() {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setChecking(true);
    setOrderCheckFailed(false);
    setBalanceStatus("idle");
    try {
      const results = await Promise.allSettled([
        history.refetch().then((result) => {
          if (result.isError) throw result.error;
          return result.data ?? null;
        }),
        refreshAccount ? refreshAccount() : Promise.resolve(false),
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
            (record) =>
              record.source === "order" &&
              ((createdOrder.tradeNo &&
                record.refId === createdOrder.tradeNo) ||
                (createdOrder.orderId &&
                  record.refId === createdOrder.orderId)),
          );
          if (matched)
            setCreatedOrder({
              ...createdOrder,
              status: matched.status,
              creditAmount: matched.creditAmount ?? createdOrder.creditAmount,
            });
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

  async function redeem() {
    const key = redeemKey.trim();
    if (redeemBusy || !key) return;
    setRedeemBusy(true);
    setRedeemResult(null);
    try {
      const credited = await relayApi.redeemCode(key);
      if (!mounted.current) return;
      setRedeemResult({ ok: true, credited });
      setRedeemKey("");
      void refreshAccount?.();
      void history.refetch();
    } catch (error) {
      if (!mounted.current) return;
      if (relayErrorKey(error) === "expired") {
        notifySessionExpired(error);
        return;
      }
      setRedeemResult({ ok: false, key: relayErrorKey(error) });
    } finally {
      setRedeemBusy(false);
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
            {/* 单卡收银台（对齐站点充值页布局）：
                左列 = 金额瓦片 → 自定义金额 → 支付方式 → 兑换码
                右列 = 结算面板（支付金额 + 去付款） */}
            <div className="rd-wallet-composer">
              <div className="rd-wallet-composer-main">
                <div className="rd-wallet-step">
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
                    {options.map((option) => {
                      const symbol =
                        option.currencySymbol ??
                        info.data?.currencySymbol ??
                        account.currencySymbol ??
                        "";
                      const label = option.label ?? `${symbol}${option.amount}`;
                      // 优惠以该档位+当前支付方式的真实报价为准；
                      // quote 未返回时退回 amount_options 的 discount/credit 字段
                      const quotePay = presetQuoteMap.get(option.amount);
                      const payable =
                        quotePay != null &&
                        quotePay > 0 &&
                        quotePay < option.amount
                          ? quotePay
                          : option.discount != null &&
                              option.discount > 0 &&
                              option.discount < 1
                            ? option.amount * option.discount
                            : null;
                      const pct =
                        payable != null
                          ? Math.round(
                              ((option.amount - payable) / option.amount) * 100,
                            )
                          : discountPct(option);
                      const saved =
                        payable != null
                          ? option.amount - payable
                          : option.creditAmount != null &&
                              option.creditAmount > option.amount
                            ? option.creditAmount - option.amount
                            : null;
                      const selected =
                        customAmount.trim() === "" &&
                        activeAmount === option.amount;
                      return (
                        <button
                          key={`${option.amount}-${label}`}
                          type="button"
                          aria-pressed={selected}
                          className={`rd-wallet-choice${selected ? " is-selected" : ""}`}
                          onClick={() => {
                            setAmount(option.amount);
                            setCustomAmount("");
                          }}
                        >
                          <span className="rd-wallet-choice-top">
                            <strong>{label}</strong>
                            {pct != null && pct > 0 && (
                              <em className="rd-wallet-choice-off">
                                {t("topupDiscountBadge", { pct })}
                              </em>
                            )}
                          </span>
                          {payable != null && saved != null && saved > 0 && (
                            <small className="rd-wallet-choice-sub">
                              {t("topupTileSavings", {
                                pay: `${symbol}${payable.toFixed(0)}`,
                                save: `${symbol}${saved.toFixed(0)}`,
                              })}
                            </small>
                          )}
                        </button>
                      );
                    })}
                    {/* 自定义金额：与金额瓦片同一行流内对齐，成为第 6 个"瓦片" */}
                    <div
                      className={`rd-wallet-choice rd-wallet-choice-custom${
                        customAmount.trim() !== "" ? " is-selected" : ""
                      }`}
                    >
                      <label htmlFor="rd-topup-custom">
                        {t("topupCustomAmount")}
                      </label>
                      <input
                        id="rd-topup-custom"
                        className="rd-wallet-custom-input"
                        inputMode="numeric"
                        placeholder={t("topupCustomPlaceholder")}
                        value={customAmount}
                        onChange={(event) =>
                          setCustomAmount(event.target.value)
                        }
                      />
                      {customAmount.trim() !== "" && (
                        <span className="rd-muted rd-wallet-custom-quote">
                          {t("topupPayAmount")}:{" "}
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
                        </span>
                      )}
                    </div>
                  </div>
                  {customAmount.trim() !== "" && !customValid && (
                    <p className="rd-danger-text" role="alert">
                      {t("topupCustomInvalid", { min: minAmount })}
                    </p>
                  )}
                </div>
                <div className="rd-wallet-step">
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
                        <button
                          type="button"
                          role="radio"
                          aria-checked={activeMethod === item.id}
                          className={`rd-wallet-method${activeMethod === item.id ? " is-selected" : ""}`}
                          key={item.id}
                          onClick={() => setMethod(item.id)}
                        >
                          <MethodIcon id={item.id} />
                          <span>
                            <strong>{item.label ?? item.id}</strong>
                            {item.description && (
                              <small>{item.description}</small>
                            )}
                          </span>
                        </button>
                      ))
                    ) : (
                      <span className="rd-muted">{t("topupNoMethods")}</span>
                    )}
                  </div>
                </div>
              </div>
              {/* 右侧结算面板：需支付金额 + 去付款（对应原型右栏） */}
              <aside
                className="rd-wallet-summary"
                aria-label={t("topupPayAmount")}
              >
                <div className="rd-wallet-paybar">
                  <div className="rd-wallet-quote" aria-live="polite">
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
                    <small className="rd-muted">
                      {quote.isError
                        ? t("topupQuoteUnavailable")
                        : quote.isFetching
                          ? t("topupQuoteLoading")
                          : t("topupQuotePending")}
                    </small>
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
                </div>
              </aside>
              {/* 兑换码：通栏一行，跨过左右两列（与站点充值页一致） */}
              <div className="rd-wallet-redeem-inline">
                <span className="rd-muted">{t("redeemInlineHint")}</span>
                <form
                  className="rd-wallet-redeem-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void redeem();
                  }}
                >
                  <input
                    className="rd-input"
                    placeholder={t("redeemPlaceholder")}
                    aria-label={t("redeemTitle")}
                    value={redeemKey}
                    onChange={(event) => setRedeemKey(event.target.value)}
                  />
                  <Action
                    primary
                    disabled={redeemBusy || !redeemKey.trim()}
                    type="submit"
                  >
                    {redeemBusy ? (
                      <RefreshCw size={13} className="rd-spin" />
                    ) : null}
                    {t(redeemBusy ? "redeeming" : "redeemSubmit")}
                  </Action>
                </form>
                {redeemResult && (
                  <p
                    role={redeemResult.ok ? "status" : "alert"}
                    className={`rd-alert ${redeemResult.ok ? "success" : "error"}`}
                  >
                    {redeemResult.ok
                      ? redeemResult.credited != null
                        ? t("redeemSuccessAmount", {
                            amount: formatRelayQuota(
                              redeemResult.credited,
                              account,
                            ),
                          })
                        : t("redeemSuccess")
                      : t(redeemResult.key)}
                  </p>
                )}
              </div>
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
                    {t("topupOrder")}:{" "}
                    {orderLabel(
                      createdOrder.tradeNo ?? createdOrder.orderId ?? "",
                    )}
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
                  <th>{t("topupDetail")}</th>
                  <th>{t("topupCreatedAt")}</th>
                  <th>{t("topupPayAmount")}</th>
                  <th>{t("topupCreditAmount")}</th>
                  <th>{t("topupPaymentMethod")}</th>
                  <th>{t("topupStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {history.data.items.map((record) => (
                  <tr key={`${record.source}-${record.refId}`}>
                    <td
                      className={record.source === "order" ? "rd-mono" : ""}
                      title={record.note ?? record.refId}
                    >
                      {record.source === "order"
                        ? orderLabel(record.refId)
                        : (record.note ?? "—")}
                    </td>
                    <td>
                      {record.createdAtMs === undefined
                        ? "—"
                        : formatDate(
                            new Date(record.createdAtMs).toISOString(),
                            i18n.language,
                          )}
                    </td>
                    <td>
                      {record.payAmount === undefined
                        ? "—"
                        : formatRelayMoney(record.payAmount, {
                            currencySymbol:
                              record.currencySymbol ??
                              info.data?.currencySymbol ??
                              account.currencySymbol,
                            currencyCode:
                              record.currency ?? info.data?.currency,
                          })}
                    </td>
                    <td>
                      {record.creditAmount === undefined
                        ? "—"
                        : record.source === "log"
                          ? formatRelayQuota(record.creditAmount, account)
                          : formatRelayMoney(record.creditAmount, {
                              currencySymbol:
                                record.currencySymbol ??
                                info.data?.currencySymbol ??
                                account.currencySymbol,
                              currencyCode:
                                record.currency ?? info.data?.currency,
                            })}
                    </td>
                    <td>{methodLabel(record.method, t)}</td>
                    <td>
                      <span className={`rd-order-status ${record.status}`}>
                        {statusLabel(record.status, t)}
                      </span>
                      {record.source === "order" &&
                        ["pending", "created"].includes(record.status) &&
                        record.expiresAtMs !== undefined && (
                          <small className="rd-order-expiry">
                            {t("topupPayDeadline", {
                              time: new Date(
                                record.expiresAtMs,
                              ).toLocaleTimeString(i18n.language, {
                                hour: "2-digit",
                                minute: "2-digit",
                              }),
                            })}
                          </small>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rd-account-empty">{t("topupNoOrders")}</p>
        )}
        {history.data?.items.length ? (
          <p className="rd-muted rd-small rd-topup-scope">
            {t("topupHistoryScope")}
          </p>
        ) : null}
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
