import { Check, Copy, ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { RelayAppliedModel } from "@/lib/api/relay";
import { Action } from "../ui";
import type { ApplyReport } from "../state/useRelayApply";
import type { ModelChoice } from "./modelPresentation";
export function ModelTable({
  choices,
  current,
  busy,
  report,
  apply,
}: {
  choices: ModelChoice[];
  current?: RelayAppliedModel;
  busy: boolean;
  report: ApplyReport | null;
  apply: (group: string, model: string) => void;
}) {
  const { t } = useTranslation("relaydesk");
  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }
  return (
    <table className="rd-model-table">
      <thead>
        <tr>
          <th>{t("modelName")}</th>
          <th className="rd-capability-col">{t("capabilities")}</th>
          <th className="rd-price-col">{t("pricing")}</th>
          <th>{t("modelGroup")}</th>
          <th className="rd-action-col">{t("action")}</th>
        </tr>
      </thead>
      <tbody>
        {choices.map(({ group, ratio, model }) => {
          const active = group === current?.group && model.id === current.model;
          const phase =
            report?.group === group && report.model === model.id
              ? report.phase
              : null;
          const modelRatio = model.modelRatio;
          const groupRatio = model.groupRatio ?? ratio;
          const tooltip = [
            modelRatio != null && `${t("modelRatio")} ×${modelRatio}`,
            groupRatio != null && `${t("groupRatio")} ×${groupRatio}`,
            model.completionRatio != null &&
              `${t("completionRatio")} ×${model.completionRatio}`,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <tr
              key={JSON.stringify([group, model.id])}
              className={active ? "is-current" : ""}
            >
              <td>
                <div className="rd-model-name">
                  <span className="rd-model-symbol">
                    {model.id.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <span className="rd-model-id" title={model.id}>
                      {model.id}
                    </span>
                    {model.description && (
                      <p
                        className="rd-model-description"
                        title={model.description}
                      >
                        {model.description}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="rd-copy"
                    aria-label={`${t("copyId")}: ${model.id} / ${group}`}
                    title={t("copyId")}
                    onClick={() => void copy(model.id)}
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </td>
              <td className="rd-capability-col">
                <div className="rd-tags">
                  {(model.tags ?? []).slice(0, 2).map((tag) => (
                    <span className="rd-tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </td>
              <td className="rd-price-col">
                <span className="rd-rate" title={tooltip || t("unknownPrice")}>
                  {model.quotaType === 1
                    ? t("perCall")
                    : modelRatio != null
                      ? `×${modelRatio}`
                      : "—"}
                </span>
                <small className="rd-price-note">
                  {model.quotaType === 1
                    ? t("unverifiedPrice")
                    : modelRatio != null
                      ? t("modelRatio")
                      : t("unknownPrice")}
                </small>
              </td>
              <td>
                <span className="rd-group" title={group}>
                  {group}
                </span>
                {groupRatio != null && (
                  <small className="rd-price-note">×{groupRatio}</small>
                )}
              </td>
              <td className="rd-action-col">
                <Action
                  className={`${active ? "rd-in-use" : "rd-use"} ${phase ? "rd-row-phase" : ""}`}
                  disabled={busy}
                  onClick={() => apply(group, model.id)}
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
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
