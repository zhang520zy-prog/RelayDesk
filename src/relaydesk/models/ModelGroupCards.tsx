import { useMemo, useState } from "react";
import { Check, Copy, ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import type {
  RelayAppliedModel,
  RelayGroupModels,
  RelayModelInfo,
} from "@/lib/api/relay";
import { Action } from "../ui";
import type { ApplyReport } from "../state/useRelayApply";

/** 搜索过滤一个分组内的模型；无搜索词时返回全部 */
function filterModels(
  models: RelayModelInfo[],
  query: string,
): RelayModelInfo[] {
  if (!query) return models;
  const q = query.toLocaleLowerCase();
  return models.filter((m) =>
    [m.id, m.description ?? "", ...(m.tags ?? [])].some((v) =>
      v.toLocaleLowerCase().includes(q),
    ),
  );
}

function GroupCard({
  group,
  ratio,
  models,
  current,
  busy,
  report,
  apply,
}: {
  group: string;
  ratio?: number;
  models: RelayModelInfo[];
  current?: RelayAppliedModel;
  busy: boolean;
  report: ApplyReport | null;
  apply: (group: string, model: string) => void;
}) {
  const { t } = useTranslation("relaydesk");
  const activeModel = current?.group === group ? current.model : null;
  const [selected, setSelected] = useState<string>(
    activeModel ?? models[0]?.id ?? "",
  );

  // 搜索/数据刷新后当前选中项可能不在列表里，回落到第一个可选模型
  const effectiveSelected = models.some((m) => m.id === selected)
    ? selected
    : (models[0]?.id ?? "");
  const active = activeModel != null && effectiveSelected === activeModel;
  const phase = report?.group === group ? report.phase : null;

  const selectedInfo = models.find((m) => m.id === effectiveSelected);
  const priceHint = [
    selectedInfo?.modelRatio != null &&
      `${t("modelRatio")} ×${selectedInfo.modelRatio}`,
    selectedInfo?.groupRatio != null &&
      `${t("groupRatio")} ×${selectedInfo.groupRatio}`,
    selectedInfo?.completionRatio != null &&
      `${t("completionRatio")} ×${selectedInfo.completionRatio}`,
  ]
    .filter(Boolean)
    .join(" · ");

  async function copy(id: string) {
    try {
      await copyText(id);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  return (
    <li className={`rd-model-group ${active ? "is-current" : ""}`}>
      <div className="rd-model-group-name">
        <h3 title={group}>{group}</h3>
        <span className="rd-model-group-count">
          {t("modelCount", { count: models.length })}
        </span>
      </div>
      <div className="rd-model-group-billing" title={priceHint || undefined}>
        <span className="rd-rate">{ratio != null ? `×${ratio}` : "—"}</span>
        <small className="rd-price-note">{t("groupRatio")}</small>
      </div>
      <div className="rd-model-group-pick">
        <select
          className="rd-select"
          aria-label={t("selectModelIn", { group })}
          value={effectiveSelected}
          disabled={busy || !models.length}
          onChange={(e) => setSelected(e.target.value)}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
              {m.quotaType === 1 ? ` · ${t("perCall")}` : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rd-copy"
          aria-label={`${t("copyId")}: ${effectiveSelected} / ${group}`}
          title={t("copyId")}
          disabled={!effectiveSelected}
          onClick={() => void copy(effectiveSelected)}
        >
          <Copy size={13} />
        </button>
      </div>
      <Action
        className={`${active ? "rd-in-use" : "rd-use"} ${phase ? "rd-row-phase" : ""}`}
        disabled={busy || !effectiveSelected}
        onClick={() => apply(group, effectiveSelected)}
        aria-label={t(active ? "reapply" : "apply")}
        title={t(active ? "reapply" : "applyModel")}
      >
        {phase ? (
          t(phase)
        ) : active ? (
          <>
            <Check size={13} />
            {t("inUse")}
          </>
        ) : (
          <>
            {t("apply")}
            <ArrowUpRight size={13} />
          </>
        )}
      </Action>
    </li>
  );
}

export function ModelGroupCards({
  groups,
  search,
  current,
  busy,
  report,
  apply,
}: {
  groups: RelayGroupModels[];
  search: string;
  current?: RelayAppliedModel;
  busy: boolean;
  report: ApplyReport | null;
  apply: (group: string, model: string) => void;
}) {
  const visible = useMemo(() => {
    const query = search.trim();
    return groups
      .map((g) => ({ ...g, models: filterModels(g.models, query) }))
      .filter((g) => g.models.length > 0);
  }, [groups, search]);

  return (
    <ul className="rd-model-groups">
      {visible.map((g) => (
        <GroupCard
          key={g.group}
          group={g.group}
          ratio={g.ratio}
          models={g.models}
          current={current}
          busy={busy}
          report={report}
          apply={apply}
        />
      ))}
    </ul>
  );
}
