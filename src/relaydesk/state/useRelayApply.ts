import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  inferRelayTargets,
  relayApi,
  type RelayAccountInfo,
  type RelayApplyProgress,
  type RelayApplyResult,
  type RelayAppliedModel,
  type RelayTarget,
} from "@/lib/api/relay";
import { relayErrorKey } from "./relayErrors";

export const targetLabels: Record<RelayTarget, string> = {
  claude: "Claude Code",
  codex: "OpenAI Codex",
  gemini: "Gemini CLI",
};
export const targetIds = Object.keys(targetLabels) as RelayTarget[];
export type ApplyPhase =
  | "preparing"
  | "syncing"
  | "success"
  | "partial"
  | "failed";
export interface ApplyReport extends RelayAppliedModel {
  phase: ApplyPhase;
  targets: RelayTarget[];
  results: RelayApplyResult[];
  error?: string;
  /** Only targets that succeeded in the latest request may be offered for launch. */
  launchTargets?: RelayTarget[];
  operationId?: string;
}
export function useRelayApply(
  account: RelayAccountInfo | null | undefined,
  applied: (model: RelayAppliedModel) => Promise<void>,
  onError: (error: unknown) => string,
  generation: { readonly current: number },
) {
  const [report, setReport] = useState<ApplyReport | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const active = useRef<string | null>(null);
  const mounted = useRef(true);
  const subscription = useRef<UnlistenFn>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      subscription.current?.();
    };
  }, []);
  const identity = account
    ? `${account.baseUrl}:${account.userId ?? account.username}`
    : "";
  const epoch = generation.current;
  useEffect(() => {
    setReport(null);
    setNotice(null);
    setOpen(false);
  }, [identity, epoch]);
  async function apply(group: string, model: string, targetApp?: RelayTarget) {
    if (active.current || !account) return;
    // 重试只跑单目标；首次应用优先读取用户保存的分组映射。
    const mapped = account.groupTargets?.[group];
    const wanted: RelayTarget[] = targetApp
      ? [targetApp]
      : mapped
        ? [mapped]
        : inferRelayTargets(group);
    const anyEnabled = targetIds.some((id) => account.applyApps[id]);
    const selected = wanted.filter((id) => account.applyApps[id]);
    if (!selected.length) {
      setNotice(targetApp || !anyEnabled ? "noTargets" : "targetDisabled");
      return;
    }
    const operationEpoch = generation.current;
    const isCurrent = () =>
      mounted.current && generation.current === operationEpoch;
    const requestId = crypto.randomUUID();
    active.current = requestId;
    const previous =
      targetApp && report?.group === group && report.model === model
        ? report
        : null;
    const retained = previous?.results.filter((r) => r.app !== targetApp) ?? [];
    const targets = previous?.targets ?? selected;
    setNotice(null);
    setPending(true);
    setOpen(true);
    setReport({
      group,
      model,
      targets,
      results: retained,
      phase: "preparing",
      launchTargets: [],
      operationId: requestId,
    });
    try {
      subscription.current = await listen<RelayApplyProgress>(
        "relay-apply-progress",
        ({ payload }) => {
          if (active.current !== payload.requestId || !isCurrent()) return;
          if (payload.stage === "syncing")
            setReport((old) => (old ? { ...old, phase: "syncing" } : old));
        },
      );
      if (!isCurrent()) return;
      const returned = await relayApi.applyModel(group, model, {
        requestId,
        targetApps: selected,
      });
      if (!isCurrent()) return;
      // Missing results are failures, never infer success from an empty response.
      const results = [
        ...retained,
        ...selected.map(
          (app) => returned.find((r) => r.app === app) ?? { app, ok: false },
        ),
      ];
      const successes = results.filter((r) => r.ok).length;
      const phase: ApplyPhase =
        successes === targets.length
          ? "success"
          : successes
            ? "partial"
            : "failed";
      const launchTargets = selected.filter((app) =>
        returned.some((result) => result.app === app && result.ok),
      );
      setReport({
        group,
        model,
        targets,
        results,
        phase,
        launchTargets,
        operationId: requestId,
      });
      if (returned.some((r) => selected.includes(r.app as RelayTarget) && r.ok))
        await applied({ group, model });
    } catch (e) {
      if (!isCurrent()) return;
      const error = relayErrorKey(e);
      onError(e);
      setReport({
        group,
        model,
        targets,
        results: [...retained, ...selected.map((app) => ({ app, ok: false }))],
        phase: retained.some((r) => r.ok) ? "partial" : "failed",
        error,
        launchTargets: [],
        operationId: requestId,
      });
    } finally {
      subscription.current?.();
      subscription.current = undefined;
      active.current = null;
      if (mounted.current) setPending(false);
    }
  }
  return { report, open, setOpen, notice, pending, apply };
}
