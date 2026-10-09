import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, X } from "lucide-react";
import { relayApi, type RelayAccountInfo } from "@/lib/api/relay";

const DISMISS_KEY = "relaydesk.onboarding.dismissed";
const COMPLETE_HOLD_MS = 2400;

type StepId = "login" | "install" | "enable" | "apply";

export function isOnboardingDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function resetOnboardingDismissal() {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    // ignore
  }
}

const SEEN_KEY = "relaydesk.seenAccounts";

/** 本机是否见过该账号（按 base+username 识别）。未见过的账号首登落环境部署页。 */
export function accountSeenBefore(account: RelayAccountInfo) {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(seen) && seen.includes(accountKey(account));
  } catch {
    return false;
  }
}

export function markAccountSeen(account: RelayAccountInfo) {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    const list = Array.isArray(seen) ? seen : [];
    const key = accountKey(account);
    if (!list.includes(key)) {
      list.push(key);
      localStorage.setItem(SEEN_KEY, JSON.stringify(list));
    }
  } catch {
    // ignore
  }
}

function accountKey(account: RelayAccountInfo) {
  return `${account.baseUrl ?? ""}::${account.username}`;
}

export function OnboardingChecklist({
  account,
  applied,
  openTargets,
  openModels,
}: {
  account: RelayAccountInfo;
  /** 已应用过模型（本会话 apply 成功或账号 lastApplied 已存在） */
  applied: boolean;
  openTargets: () => void;
  openModels: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const [dismissed, setDismissed] = useState(isOnboardingDismissed);
  const [holdDone, setHoldDone] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const installations = useQuery({
    queryKey: ["relaydesk", "environment", "installations"],
    queryFn: relayApi.detectTargetInstallations,
    retry: false,
    staleTime: 30_000,
  });

  const steps = useMemo(() => {
    const anyInstalled =
      installations.data?.some((i) => i.cliPath || i.desktopApp) ?? false;
    const anyEnabled = Object.values(account.applyApps ?? {}).some(Boolean);
    const defs: { id: StepId; done: boolean; cta: string; go: () => void }[] = [
      { id: "login", done: true, cta: "", go: () => {} },
      {
        id: "install",
        done: anyInstalled,
        cta: "onboardingGoInstall",
        // 本卡就在环境部署页内，CTA 直接滚动到工具区
        go: () =>
          document
            .querySelector(".rd-deployment-tools")
            ?.scrollIntoView({ block: "center" }),
      },
      {
        id: "enable",
        done: anyEnabled,
        cta: "onboardingGoEnable",
        go: openTargets,
      },
      {
        id: "apply",
        done: applied,
        cta: "onboardingGoApply",
        go: openModels,
      },
    ];
    const firstUndone = defs.findIndex((s) => !s.done);
    return defs.map((s, i) => ({
      ...s,
      state: s.done
        ? ("done" as const)
        : i === firstUndone
          ? ("current" as const)
          : ("pending" as const),
    }));
  }, [installations.data, account.applyApps, applied, openTargets, openModels]);

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  // 全部完成后短暂展示完成态，再自动收起并持久化
  useEffect(() => {
    if (!allDone) {
      setHoldDone(false);
      return;
    }
    const timer = setTimeout(() => {
      setHoldDone(true);
      try {
        localStorage.setItem(DISMISS_KEY, "1");
      } catch {
        // ignore
      }
    }, COMPLETE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [allDone]);

  if (dismissed || holdDone) return null;

  return (
    <section
      ref={cardRef}
      className={`rd-onboarding ${allDone ? "is-complete" : ""}`}
      aria-label={t("onboardingTitle")}
    >
      <div className="rd-onboarding-head">
        <div>
          <h2>{t("onboardingTitle")}</h2>
          <p className="rd-muted">{t("onboardingHint")}</p>
        </div>
        <div className="rd-onboarding-progress" aria-hidden="true">
          <span className="rd-onboarding-count">
            {doneCount}/{steps.length}
          </span>
          <div className="rd-onboarding-bar">
            <i style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
        </div>
        <button
          type="button"
          className="rd-onboarding-skip"
          aria-label={t("onboardingSkip")}
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(DISMISS_KEY, "1");
            } catch {
              // ignore
            }
          }}
        >
          <X size={14} aria-hidden="true" />
          {t("onboardingSkip")}
        </button>
      </div>
      <ol className="rd-onboarding-steps">
        {steps.map((step, index) => {
          const isCurrent = step.state === "current";
          return (
            <li
              key={step.id}
              className={`rd-onboarding-step is-${step.state}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className="rd-onboarding-dot" aria-hidden="true">
                {step.done ? <Check size={13} strokeWidth={3} /> : index + 1}
              </span>
              <div className="rd-onboarding-step-body">
                <span className="rd-onboarding-step-title">
                  {t(`onboardingStep_${step.id}`)}
                </span>
                <span className="rd-onboarding-step-desc">
                  {t(`onboardingStepDesc_${step.id}`)}
                </span>
              </div>
              {!step.done && (
                <button
                  type="button"
                  className={`rd-onboarding-cta ${isCurrent ? "is-pulse" : ""}`}
                  onClick={step.go}
                >
                  {t(step.cta)}
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              )}
              {step.done && step.id !== "login" && (
                <span className="rd-onboarding-done-label">
                  {t("onboardingStepDone")}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {allDone && (
        <div className="rd-onboarding-celebrate" role="status">
          <Check size={15} strokeWidth={3} />
          {t("onboardingDone")}
        </div>
      )}
    </section>
  );
}
