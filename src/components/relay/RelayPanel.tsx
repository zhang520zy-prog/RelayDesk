import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  Server,
  Wallet,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  relayApi,
  quotaToUsd,
  type RelayAccountInfo,
  type RelayApplyResult,
  type RelayGroupModels,
  type RelayModelInfo,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const APP_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

export function RelayPanel() {
  const [account, setAccount] = useState<RelayAccountInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setAccount(await relayApi.getAccount());
    } catch {
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!account) {
    return <RelayLoginForm onLoggedIn={setAccount} />;
  }

  return (
    <RelayWorkspace
      account={account}
      onAccountChange={setAccount}
      onLoggedOut={() => setAccount(null)}
    />
  );
}

// ---------------------------------------------------------------------------
// 登录表单
// ---------------------------------------------------------------------------

function RelayLoginForm({
  onLoggedIn,
}: {
  onLoggedIn: (account: RelayAccountInfo) => void;
}) {
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = baseUrl.trim() !== "" && username !== "" && password !== "";

  const handleLogin = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const acc = await relayApi.login(baseUrl.trim(), username, password);
      onLoggedIn(acc);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Server className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">
              {t("relay.loginTitle", {
                defaultValue: "连接中转站",
              })}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("relay.loginSubtitle", {
                defaultValue: "登录 new-api 账号以查看分组与模型",
              })}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="relay-base-url">
              {t("relay.baseUrl", { defaultValue: "实例地址" })}
            </Label>
            <Input
              id="relay-base-url"
              placeholder="https://api.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="relay-username">
              {t("relay.username", { defaultValue: "用户名" })}
            </Label>
            <Input
              id="relay-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="relay-password">
              {t("relay.password", { defaultValue: "密码" })}
            </Label>
            <Input
              id="relay-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) void handleLogin();
              }}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button
            className="w-full"
            disabled={!canSubmit || submitting}
            onClick={() => void handleLogin()}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("relay.login", { defaultValue: "登录" })}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 主工作区：账号信息 + 应用开关 + 分组/模型列表
// ---------------------------------------------------------------------------

function RelayWorkspace({
  account,
  onAccountChange,
  onLoggedOut,
}: {
  account: RelayAccountInfo;
  onAccountChange: (account: RelayAccountInfo) => void;
  onLoggedOut: () => void;
}) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<RelayGroupModels[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [applying, setApplying] = useState<string | null>(null);

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setRefreshing(true);
      setLoadingData(true);
      try {
        const [acc, modelGroups] = await Promise.all([
          relayApi.refreshAccount(),
          relayApi.listModels(),
        ]);
        onAccountChange(acc);
        // tags 空数组在 Rust 端被 skip_serializing 省略 → 归一化为 []
        setGroups(
          modelGroups.map((g) => ({
            ...g,
            models: g.models.map((m) => ({ ...m, tags: m.tags ?? [] })),
          })),
        );
        setActiveGroup((prev) => {
          if (prev && modelGroups.some((g) => g.group === prev)) return prev;
          return modelGroups[0]?.group ?? null;
        });
      } catch (e) {
        toast.error(
          t("relay.loadFailed", {
            defaultValue: "加载中转站数据失败：{{error}}",
            error: String(e),
          }),
        );
      } finally {
        setLoadingData(false);
        setRefreshing(false);
      }
    },
    [onAccountChange, t],
  );

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleApp = async (
    key: "claude" | "codex" | "gemini",
    checked: boolean,
  ) => {
    const next = { ...account.applyApps, [key]: checked };
    try {
      onAccountChange(await relayApi.setApplyApps(next));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleApply = async (group: string, model: RelayModelInfo) => {
    const key = `${group}:${model.id}`;
    setApplying(key);
    try {
      const results: RelayApplyResult[] = await relayApi.applyModel(
        group,
        model.id,
      );
      const failures = results.filter((r) => !r.ok);
      if (results.length === 0) {
        toast.info(
          t("relay.noTargets", {
            defaultValue: "未选择要应用的应用，请先开启上方开关",
          }),
        );
      } else if (failures.length === 0) {
        toast.success(
          t("relay.applySuccess", {
            defaultValue: "{{model}} 已应用到 {{apps}}",
            model: model.id,
            apps: results.map((r) => APP_LABELS[r.app] ?? r.app).join("、"),
          }),
        );
      } else {
        toast.warning(
          t("relay.applyPartial", {
            defaultValue: "部分应用失败：{{errors}}",
            errors: failures
              .map((f) => `${APP_LABELS[f.app] ?? f.app}: ${f.error ?? "?"}`)
              .join("；"),
          }),
        );
      }
      const acc = await relayApi.getAccount();
      if (acc) onAccountChange(acc);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setApplying(null);
    }
  };

  const handleLogout = async () => {
    try {
      await relayApi.logout();
    } finally {
      onLoggedOut();
    }
  };

  const activeModels = useMemo(() => {
    const g = groups.find((x) => x.group === activeGroup);
    if (!g) return [];
    const q = search.trim().toLowerCase();
    if (!q) return g.models;
    return g.models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        (m.tags ?? []).some((tag) => tag.toLowerCase().includes(q)) ||
        (m.description?.toLowerCase().includes(q) ?? false),
    );
  }, [groups, activeGroup, search]);

  const balanceUsd = quotaToUsd(account.quota);
  const appliedKey = account.lastApplied
    ? `${account.lastApplied.group}:${account.lastApplied.model}`
    : null;

  return (
    <div className="flex h-full flex-col">
      {/* 账号与额度 */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
              <Wallet className="h-4 w-4 text-emerald-500" />
            </div>
            <div>
              <div className="text-sm font-medium">
                {account.username}
                <span className="ml-2 text-xs text-muted-foreground">
                  {account.baseUrl}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {t("relay.balance", {
                  defaultValue: "余额 ${{amount}} · 已用 ${{used}}",
                  amount: balanceUsd.toFixed(2),
                  used: quotaToUsd(account.usedQuota).toFixed(2),
                })}
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-4">
            {(["claude", "codex", "gemini"] as const).map((key) => (
              <div key={key} className="flex items-center gap-2">
                <Switch
                  checked={account.applyApps[key]}
                  onCheckedChange={(c) => void handleToggleApp(key, c)}
                />
                <span className="text-xs">{APP_LABELS[key]}</span>
              </div>
            ))}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void refresh()}
              disabled={refreshing}
              title={t("relay.refresh", { defaultValue: "刷新" })}
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void handleLogout()}
              title={t("relay.logout", { defaultValue: "退出登录" })}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* 分组 + 模型 */}
      <div className="flex min-h-0 flex-1">
        {/* 分组侧栏 */}
        <div className="w-44 shrink-0 border-r border-border">
          <ScrollArea className="h-full">
            <div className="p-2">
              {groups.map((g) => {
                const isActive = g.group === activeGroup;
                const applied = account.lastApplied?.group === g.group;
                return (
                  <button
                    key={g.group}
                    onClick={() => setActiveGroup(g.group)}
                    className={cn(
                      "mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50",
                    )}
                  >
                    <span className="truncate">{g.group}</span>
                    <span className="flex items-center gap-1">
                      {applied && (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      )}
                      <Badge variant="secondary" className="text-[10px]">
                        {g.models.length}
                      </Badge>
                    </span>
                  </button>
                );
              })}
              {!loadingData && groups.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  {t("relay.noGroups", { defaultValue: "暂无可用分组" })}
                </p>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* 模型列表 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={t("relay.searchModel", {
                  defaultValue: "搜索模型…",
                })}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3">
              {loadingData ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : activeModels.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {t("relay.noModels", { defaultValue: "该分组暂无模型" })}
                </p>
              ) : (
                activeModels.map((m) => {
                  const key = `${activeGroup}:${m.id}`;
                  const isApplied = key === appliedKey;
                  const isApplying = applying === key;
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "mb-2 flex items-center gap-3 rounded-xl border px-4 py-3",
                        isApplied
                          ? "border-emerald-500/50 bg-emerald-500/5"
                          : "border-border bg-card",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {m.id}
                          </span>
                          {isApplied && (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/50 text-emerald-600"
                            >
                              {t("relay.inUse", { defaultValue: "使用中" })}
                            </Badge>
                          )}
                        </div>
                        {(m.description || (m.tags?.length ?? 0) > 0) && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {m.description && (
                              <span className="text-xs text-muted-foreground">
                                {m.description}
                              </span>
                            )}
                            {(m.tags ?? []).slice(0, 4).map((tag) => (
                              <Badge
                                key={tag}
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      {m.modelRatio !== undefined && (
                        <span className="text-xs text-muted-foreground">
                          {m.modelPrice !== undefined && m.modelPrice > 0
                            ? `$${m.modelPrice}`
                            : `×${m.modelRatio}`}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant={isApplied ? "secondary" : "default"}
                        disabled={isApplying}
                        onClick={() =>
                          activeGroup &&
                          void handleApply(activeGroup, m)
                        }
                      >
                        {isApplying ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                        <span className="ml-1.5">
                          {isApplied
                            ? t("relay.reapply", { defaultValue: "重新应用" })
                            : t("relay.apply", { defaultValue: "使用" })}
                        </span>
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
