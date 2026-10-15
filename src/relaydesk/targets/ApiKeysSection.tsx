import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  relayApi,
  type RelayCreatedToken,
  type RelayGroup,
  type RelayToken,
} from "@/lib/api/relay";
import { Switch } from "@/components/ui/switch";
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

/** 列表里只有掩码 key；复制时先按需取全量再写剪贴板 */
function CopyTokenKey({ id }: { id: number }) {
  const { t } = useTranslation("relaydesk");
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="rd-path-action"
      title={t("copyKey")}
      aria-label={t("copyKey")}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        relayApi
          .getApiTokenKey(id)
          .then((key) => copyText(key))
          .then(() => toast.success(t("copied")))
          .catch(() => toast.error(t("apiKeyCopyFailed")))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? <Loader2 size={14} className="rd-spin" /> : <Copy size={14} />}
    </button>
  );
}

const EXPIRY_OPTIONS = [
  { days: -1, key: "expiryForever" },
  { days: 90, key: "expiry90d" },
  { days: 30, key: "expiry30d" },
  { days: 7, key: "expiry7d" },
] as const;

function TokenEditForm({
  token,
  groups,
  onDone,
}: {
  token: RelayToken;
  groups: RelayGroup[];
  onDone: () => void;
}) {
  const { t } = useTranslation("relaydesk");
  const queryClient = useQueryClient();
  const [name, setName] = useState(token.name);
  const [group, setGroup] = useState(token.group);
  const [enabled, setEnabled] = useState(token.status === 1);
  const [expiry, setExpiry] = useState("-1");

  const update = useMutation({
    mutationFn: () =>
      relayApi.updateApiToken(token.id, {
        name: name.trim(),
        group,
        expiredTime:
          expiry === "-1"
            ? -1
            : Math.floor(Date.now() / 1000) + Number(expiry) * 86400,
        status: enabled ? 1 : 2,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["relaydesk", "apiTokens"],
      });
      toast.success(t("apiKeyUpdated"));
      onDone();
    },
    onError: () => toast.error(t("apiKeyUpdateFailed")),
  });

  return (
    <form
      className="rd-apikeys-edit"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || update.isPending) return;
        update.mutate();
      }}
    >
      <label className="rd-apikeys-field">
        <span>{t("apiKeyName")}</span>
        <Field
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("apiKeyNamePlaceholder")}
          maxLength={64}
        />
      </label>
      <label className="rd-apikeys-field">
        <span>{t("apiKeyGroup")}</span>
        <select
          className="rd-input"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
        >
          {groups.map((g) => (
            <option key={g.name} value={g.name}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label className="rd-apikeys-field">
        <span>{t("apiKeyExpiry")}</span>
        <select
          className="rd-input"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
        >
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.days} value={String(o.days)}>
              {t(o.key)}
            </option>
          ))}
        </select>
      </label>
      <label className="rd-apikeys-field rd-apikeys-toggle">
        <span>{t("apiKeyStatus")}</span>
        <span className="rd-apikeys-toggle-inner">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <em>{t(enabled ? "enabled" : "apiKeyDisabled")}</em>
        </span>
      </label>
      <div className="rd-apikeys-edit-actions">
        <Action
          primary
          type="submit"
          disabled={!name.trim() || update.isPending}
        >
          {update.isPending ? <Loader2 size={13} className="rd-spin" /> : null}
          {t("save")}
        </Action>
        <Action type="button" onClick={onDone}>
          {t("cancel")}
        </Action>
      </div>
    </form>
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
  loading,
}: {
  baseUrl: string;
  groups: RelayGroup[];
  loading?: boolean;
}) {
  const { t } = useTranslation("relaydesk");
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
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
        {items.map((token) =>
          editingId === token.id ? (
            <li key={token.id} className="rd-apikeys-item is-editing">
              <TokenEditForm
                token={token}
                groups={groups}
                onDone={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={token.id} className="rd-apikeys-item">
              <div className="rd-apikeys-item-main">
                <strong>{token.name}</strong>
                <span className="rd-muted">
                  {token.group} · {token.key || "sk-***"} ·{" "}
                  {formatCreated(token.createdTime)}
                </span>
              </div>
              {/* 停用徽标列固定占位：保持尾部三个操作图标的横向对齐 */}
              <span className="rd-apikeys-status rd-muted">
                {token.status !== 1 ? t("apiKeyDisabled") : ""}
              </span>
              <CopyTokenKey id={token.id} />
              <button
                type="button"
                className="rd-path-action"
                title={t("apiKeyEdit")}
                aria-label={t("apiKeyEdit")}
                onClick={() => setEditingId(token.id)}
              >
                <Pencil size={14} />
              </button>
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
          ),
        )}
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
            disabled={loading}
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
