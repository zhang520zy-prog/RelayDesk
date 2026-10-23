import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  universalApi,
  type RelayTarget,
  type UniversalProvider,
} from "@/lib/api/relay";
import { Action, Field } from "../ui";
import type { ModelProgram } from "./modelPresentation";

const CUSTOM_TARGETS: RelayTarget[] = ["claude", "codex", "gemini", "grok"];
/** apply 自动建的统一供应商带 relay- 前缀——不混进自建列表（它们由模型卡管理） */
const RELAY_MANAGED_PREFIX = "relay-";

/** 自建 API 供应（非本中转站）：让用户把别家 relay 接进 RelayDesk 用。
 *  写入走 universal provider → sync → switch，claude 的 3p 桌面端 profile
 *  由 switch 钩子自动写。 */
export function CustomProviders({ program }: { program: ModelProgram | null }) {
  const { t } = useTranslation("relaydesk");
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);

  const providers = useQuery({
    queryKey: ["relaydesk", "universal-providers"],
    queryFn: () => universalApi.list(),
    staleTime: 60 * 1000,
  });

  const list = Object.values(providers.data ?? {}).filter(
    (p) => !p.id.startsWith(RELAY_MANAGED_PREFIX),
  );
  const visible = program
    ? list.filter(
        (p) => program !== "devin" && p.apps[program as keyof typeof p.apps],
      )
    : list;

  const invalidate = () =>
    client.invalidateQueries({
      queryKey: ["relaydesk", "universal-providers"],
    });

  return (
    <div className="rd-custom-providers">
      <div className="rd-custom-providers__head">
        <h3>{t("customProviders")}</h3>
        <Action onClick={() => setAdding(true)} aria-label={t("addProvider")}>
          <Plus size={14} />
          {t("addProvider")}
        </Action>
      </div>
      {visible.length > 0 && (
        <ul className="rd-custom-providers__list">
          {visible.map((p) => (
            <CustomProviderRow key={p.id} provider={p} onChanged={invalidate} />
          ))}
        </ul>
      )}
      {adding && (
        <AddProviderDialog
          defaultTargets={program && program !== "devin" ? [program] : []}
          onClose={() => setAdding(false)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

function CustomProviderRow({
  provider,
  onChanged,
}: {
  provider: UniversalProvider;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation("relaydesk");
  const [busy, setBusy] = useState<string | null>(null);

  const apply = useMutation({
    mutationFn: async () => {
      await universalApi.sync(provider.id);
      // 逐个切换为当前供应商——switch 钩子同步写 claude 3p 桌面端 profile
      for (const app of CUSTOM_TARGETS) {
        if (provider.apps[app]) {
          await universalApi.activate(app, provider.id);
        }
      }
    },
    onSuccess: async () => {
      toast.success(t("providerApplied", { name: provider.name }));
      await onChanged();
    },
    onError: (e) => toast.error(String(e)),
    onSettled: () => setBusy(null),
  });

  const remove = useMutation({
    mutationFn: () => universalApi.remove(provider.id),
    onSuccess: async () => {
      toast.success(t("providerDeleted", { name: provider.name }));
      await onChanged();
    },
    onError: (e) => toast.error(String(e)),
    onSettled: () => setBusy(null),
  });

  return (
    <li className="rd-custom-provider">
      <div className="rd-custom-provider__meta">
        <strong>{provider.name}</strong>
        <span className="rd-muted rd-mono">{provider.baseUrl}</span>
      </div>
      <div className="rd-custom-provider__apps">
        {CUSTOM_TARGETS.filter((app) => provider.apps[app]).map((app) => (
          <span key={app} className="rd-custom-provider__app">
            {app}
          </span>
        ))}
      </div>
      <div className="rd-custom-provider__ops">
        <Action
          disabled={busy != null}
          onClick={() => {
            setBusy("apply");
            apply.mutate();
          }}
        >
          {busy === "apply" ? <Loader2 size={13} className="rd-spin" /> : null}
          {t("useProvider")}
        </Action>
        <Action
          disabled={busy != null}
          onClick={() => {
            setBusy("delete");
            remove.mutate();
          }}
          aria-label={t("deleteProvider")}
        >
          <Trash2 size={13} />
        </Action>
      </div>
    </li>
  );
}

function AddProviderDialog({
  defaultTargets,
  onClose,
  onSaved,
}: {
  defaultTargets: RelayTarget[];
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const { t } = useTranslation("relaydesk");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [targets, setTargets] = useState<RelayTarget[]>(
    defaultTargets.length > 0 ? defaultTargets : ["claude"],
  );
  const [locked, setLocked] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const id = `custom-${Date.now().toString(36)}`;
      const provider: UniversalProvider = {
        id,
        name: name.trim(),
        providerType: "custom",
        apps: {
          claude: targets.includes("claude"),
          codex: targets.includes("codex"),
          gemini: targets.includes("gemini"),
          grok: targets.includes("grok"),
        },
        baseUrl: baseUrl.trim().replace(/\/+$/, ""),
        apiKey: apiKey.trim(),
        models: {
          claude: targets.includes("claude")
            ? { model: model.trim() || undefined }
            : undefined,
          codex: targets.includes("codex")
            ? { model: model.trim() || undefined }
            : undefined,
          gemini: targets.includes("gemini")
            ? { model: model.trim() || undefined }
            : undefined,
          grok: targets.includes("grok")
            ? { model: model.trim() || undefined }
            : undefined,
        },
      };
      await universalApi.upsert(provider);
      await universalApi.sync(id);
    },
    onSuccess: async () => {
      toast.success(t("providerSaved"));
      await onSaved();
      onClose();
    },
    onError: (e) => toast.error(String(e)),
    onSettled: () => setLocked(false),
  });

  const valid =
    name.trim() && baseUrl.trim() && apiKey.trim() && targets.length > 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <DialogContent
        className="rd-dialog"
        onEscapeKeyDown={(e) => {
          if (locked) e.preventDefault();
        }}
      >
        <DialogTitle>{t("addProvider")}</DialogTitle>
        <DialogDescription>{t("addProviderHint")}</DialogDescription>
        <div className="rd-form">
          <label>
            <span>{t("providerName")}</span>
            <Field value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span>{t("providerBaseUrl")}</span>
            <Field
              value={baseUrl}
              placeholder="https://…"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
          <label>
            <span>{t("providerApiKey")}</span>
            <Field
              type="password"
              value={apiKey}
              placeholder="sk-…"
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <label>
            <span>{t("providerModel")}</span>
            <Field
              value={model}
              placeholder={t("providerModelHint")}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <fieldset>
            <legend>{t("providerTargets")}</legend>
            <div className="rd-check-row">
              {CUSTOM_TARGETS.map((app) => (
                <label key={app}>
                  <input
                    type="checkbox"
                    checked={targets.includes(app)}
                    onChange={(e) =>
                      setTargets((cur) =>
                        e.target.checked
                          ? [...cur, app]
                          : cur.filter((x) => x !== app),
                      )
                    }
                  />
                  {app}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="rd-dialog-footer">
          <Action onClick={onClose} disabled={locked}>
            {t("cancel")}
          </Action>
          <Action
            className="primary"
            disabled={!valid || locked}
            onClick={() => {
              setLocked(true);
              save.mutate();
            }}
          >
            {locked ? <Loader2 size={13} className="rd-spin" /> : null}
            {t("save")}
          </Action>
        </div>
      </DialogContent>
    </Dialog>
  );
}
