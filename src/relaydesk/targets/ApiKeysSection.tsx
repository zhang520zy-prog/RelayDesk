import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  relayApi,
  type RelayCreatedToken,
  type RelayGroup,
} from "@/lib/api/relay";
import { copyText } from "@/lib/clipboard";
import { Action, Field } from "../ui";
import "./api-keys.css";

function formatCreated(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation("relaydesk");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rd-path-action"
      title={label}
      aria-label={label}
      onClick={() => {
        void copyText(text).then(() => {
          setCopied(true);
          toast.success(t("copied"));
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

/**
 * 通用接入凭据：面向只需 Base URL + API Key 的第三方应用
 * （CherryStudio、WorkBuddy 等）。复用中转站令牌体系，
 * 列表来自 /api/token，创建/吊销走同一 API。
 */
export function ApiKeysSection({
  baseUrl,
  groups,
}: {
  baseUrl: string;
  groups: RelayGroup[];
}) {
  const { t } = useTranslation("relaydesk");
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [created, setCreated] = useState<RelayCreatedToken | null>(null);

  const tokens = useQuery({
    queryKey: ["relaydesk", "apiTokens"],
    queryFn: () => relayApi.listTokens(),
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["relaydesk", "apiTokens"] });

  const create = useMutation({
    mutationFn: () =>
      relayApi.createApiToken(name.trim(), group || groups[0]?.name || ""),
    onSuccess: (result) => {
      setCreated(result);
      setName("");
      setFormOpen(false);
      void invalidate();
    },
    onError: () => toast.error(t("apiKeyCreateFailed")),
  });
  const revoke = useMutation({
    mutationFn: (id: number) => relayApi.deleteApiToken(id),
    onSuccess: () => void invalidate(),
    onError: () => toast.error(t("apiKeyRevokeFailed")),
  });

  const items = tokens.data ?? [];
  return (
    <section className="rd-apikeys">
      <div className="rd-apikeys-head">
        <KeyRound size={17} aria-hidden="true" />
        <div>
          <h2>{t("apiKeysTitle")}</h2>
          <span className="rd-muted rd-small">{t("apiKeysTagline")}</span>
        </div>
      </div>

      <div className="rd-apikeys-url">
        <span>{t("apiKeysBaseUrl")}</span>
        <code>{baseUrl}</code>
        <CopyButton text={baseUrl} label={t("copy")} />
      </div>

      {created && (
        <div className="rd-apikeys-created" role="status">
          <span className="rd-apikeys-created-label">
            {t("apiKeysCreatedOnce")}
          </span>
          <div className="rd-apikeys-created-key">
            <code>{created.key}</code>
            <CopyButton text={created.key} label={t("copyKey")} />
          </div>
        </div>
      )}

      <ul className="rd-apikeys-list">
        {tokens.isPending && <li className="rd-muted">{t("loading")}</li>}
        {items.map((token) => (
          <li key={token.id} className="rd-apikeys-item">
            <div className="rd-apikeys-item-main">
              <strong>{token.name}</strong>
              <span className="rd-muted">
                {token.group} · {token.key || "sk-***"} ·{" "}
                {formatCreated(token.createdTime)}
              </span>
            </div>
            {token.status !== 1 && (
              <span className="rd-muted">{t("apiKeyDisabled")}</span>
            )}
            <button
              type="button"
              className="rd-path-action rd-apikeys-revoke"
              title={t("apiKeyRevoke")}
              aria-label={t("apiKeyRevoke")}
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(token.id)}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {tokens.isSuccess && items.length === 0 && (
          <li className="rd-muted">{t("apiKeysEmpty")}</li>
        )}
      </ul>

      {formOpen ? (
        <form
          className="rd-apikeys-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || create.isPending) return;
            create.mutate();
          }}
        >
          <Field
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("apiKeyNamePlaceholder")}
            maxLength={64}
            autoFocus
          />
          <select
            className="rd-input rd-apikeys-group"
            value={group || groups[0]?.name || ""}
            onChange={(e) => setGroup(e.target.value)}
            aria-label={t("apiKeyGroup")}
          >
            {groups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name}
              </option>
            ))}
          </select>
          <Action
            primary
            type="submit"
            disabled={!name.trim() || create.isPending}
          >
            {t("apiKeyCreate")}
          </Action>
          <Action type="button" onClick={() => setFormOpen(false)}>
            {t("cancel")}
          </Action>
        </form>
      ) : (
        <Action onClick={() => setFormOpen(true)}>
          <Plus size={14} />
          {t("apiKeyNew")}
        </Action>
      )}
    </section>
  );
}
