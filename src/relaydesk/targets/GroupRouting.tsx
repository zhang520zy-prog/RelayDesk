import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import {
  inferRelayTargets,
  type RelayApplyApps,
  type RelayGroup,
  type RelayTarget,
} from "@/lib/api/relay";
import { targetIds, targetLabels } from "../state/useRelayApply";
import { Action } from "../ui";
import "./group-routing.css";

type ChangeGroupTarget = (
  group: string,
  target: RelayTarget | null,
) => Promise<boolean>;
type Selection = RelayTarget | "auto";

function GroupRoutingRow({
  group,
  target,
  apps,
  busy,
  changeGroupTarget,
}: {
  group: RelayGroup;
  target?: RelayTarget;
  apps: RelayApplyApps;
  busy: boolean;
  changeGroupTarget: ChangeGroupTarget;
}) {
  const { t } = useTranslation("relaydesk");
  const noticeId = useId();
  const saving = useRef(false);
  const [draft, setDraft] = useState<Selection | null>(null);
  const [failedSelection, setFailedSelection] = useState<Selection | null>(
    null,
  );
  const suggestion = inferRelayTargets(group.name)[0];
  const selected = draft ?? target ?? "auto";
  const effectiveTarget = selected === "auto" ? suggestion : selected;
  const disabledTarget = !apps[effectiveTarget];

  async function save(next: Selection) {
    if (busy || saving.current) return;
    saving.current = true;
    setDraft(next);
    setFailedSelection(null);
    let saved = false;
    try {
      saved = await changeGroupTarget(
        group.name,
        next === "auto" ? null : next,
      );
    } catch {
      // Keep raw backend details out of the UI, including credentials.
    } finally {
      saving.current = false;
      setDraft(null);
      if (!saved) setFailedSelection(next);
    }
  }

  return (
    <div className="rd-routing-row" role="listitem" aria-busy={draft !== null}>
      <div className="rd-routing-description">
        <strong title={group.name}>{group.name}</strong>
        {group.desc && <small title={group.desc}>{group.desc}</small>}
        <span className={`rd-routing-source ${target ? "is-local" : ""}`}>
          {t(target ? "groupRoutingLocal" : "groupRoutingAutomatic")}
        </span>
      </div>
      <div className="rd-routing-control">
        <select
          aria-label={`${group.name} · ${t("groupTarget")}`}
          aria-describedby={
            disabledTarget || failedSelection ? noticeId : undefined
          }
          value={selected}
          disabled={busy || draft !== null}
          onChange={(event) => void save(event.target.value as Selection)}
        >
          <option value="auto">
            {t("followSuggestion", { target: targetLabels[suggestion] })}
          </option>
          {targetIds.map((id) => (
            <option key={id} value={id}>
              {apps[id]
                ? targetLabels[id]
                : t("groupRoutingDisabledOption", { target: targetLabels[id] })}
            </option>
          ))}
        </select>
        {draft !== null && (
          <span className="rd-routing-saving" role="status">
            <Loader2 size={13} className="rd-spin" />
            {t("groupRoutingSaving")}
          </span>
        )}
      </div>
      {(disabledTarget || failedSelection) && (
        <div id={noticeId} className="rd-routing-notices">
          {disabledTarget && (
            <p className="rd-routing-warning">
              <AlertTriangle size={13} />
              {t("groupRoutingDisabled", {
                target: targetLabels[effectiveTarget],
              })}
            </p>
          )}
          {failedSelection && (
            <div role="alert" className="rd-routing-error">
              <span>{t("groupRoutingSaveFailed")}</span>
              <Action
                disabled={busy}
                onClick={() => void save(failedSelection)}
              >
                <RefreshCw size={13} />
                {t("retry")}
              </Action>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function GroupRouting({
  apps,
  groups,
  groupTargets,
  busy,
  loading,
  loadingError,
  refresh,
  changeGroupTarget,
}: {
  apps: RelayApplyApps;
  groups: RelayGroup[];
  groupTargets: Record<string, RelayTarget>;
  busy: boolean;
  loading: boolean;
  loadingError: boolean;
  refresh: () => void;
  changeGroupTarget: ChangeGroupTarget;
}) {
  const { t } = useTranslation("relaydesk");
  const headingId = useId();
  return (
    <section
      className="rd-group-routing rd-routing-panel"
      aria-labelledby={headingId}
    >
      <div className="rd-routing-heading">
        <div>
          <h2 id={headingId}>{t("groupRouting")}</h2>
          <p>{t("groupRoutingHint")}</p>
        </div>
        {!loading && !loadingError && (
          <span>{t("groupRoutingCount", { count: groups.length })}</span>
        )}
      </div>
      {loading && groups.length === 0 ? (
        <div
          className="rd-routing-skeleton"
          role="status"
          aria-label={t("groupRoutingLoading")}
        >
          <span className="sr-only">{t("groupRoutingLoading")}</span>
          {[0, 1, 2].map((row) => (
            <div key={row} aria-hidden="true">
              <i />
              <i />
            </div>
          ))}
        </div>
      ) : (
        <>
          {loadingError && (
            <div className="rd-routing-state rd-routing-error" role="alert">
              <span>{t("groupRoutingLoadFailed")}</span>
              <Action disabled={busy} onClick={refresh}>
                <RefreshCw size={14} />
                {t("retry")}
              </Action>
            </div>
          )}
          {groups.length ? (
            <div
              className="rd-routing-list"
              role="list"
              aria-label={t("groupRouting")}
            >
              {groups.map((group) => (
                <GroupRoutingRow
                  key={group.name}
                  group={group}
                  target={groupTargets[group.name]}
                  {...{ apps, busy, changeGroupTarget }}
                />
              ))}
            </div>
          ) : (
            !loadingError && (
              <p className="rd-routing-state">{t("groupRoutingEmpty")}</p>
            )
          )}
        </>
      )}
    </section>
  );
}
