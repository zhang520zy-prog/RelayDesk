import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// 中转站（new-api）集成 API
// ============================================================================

export interface RelayApplyApps {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}

export type RelayTarget = keyof RelayApplyApps;
export interface RelayApplyOptions {
  requestId?: string;
  targetApps?: RelayTarget[];
}
export interface RelayApplyProgress {
  requestId: string;
  stage: "preparing" | "syncing";
  app?: RelayTarget;
}

export interface RelayAppliedModel {
  group: string;
  model: string;
}

export interface RelayCurrencyConfig {
  /** 服务端 /api/status 的货币代码（如 CNY）。 */
  currencyCode?: string;
  /** 服务端 /api/status 的实际显示符号（如 ¥）。 */
  currencySymbol?: string;
  /** 服务端定义的 quota → 账户显示单位换算基数。 */
  quotaPerUnit?: number;
  quotaDisplayType?: string;
  displayInCurrency?: boolean;
  customCurrencyExchangeRate?: number;
}

export interface RelayAccountInfo extends RelayCurrencyConfig {
  remembered?: boolean;
  baseUrl: string;
  userId?: number;
  username: string;
  /** 剩余额度（服务端原始 quota 单位）。 */
  quota: number;
  usedQuota: number;
  group: string;
  applyApps: RelayApplyApps;
  groupTargets: Record<string, RelayTarget>;
  lastApplied?: RelayAppliedModel;
  updatedAt: number;
}

export interface RelaySavedLogin {
  id: string;
  baseUrl: string;
  username: string;
  userId?: number;
  updatedAt: number;
}

export interface RelayGroup {
  name: string;
  ratio?: number;
  desc?: string;
}

export interface RelayModelInfo {
  id: string;
  description?: string;
  /** 空数组在 Rust 端被 skip_serializing 省略，可能缺省 */
  tags?: string[];
  modelRatio?: number;
  groupRatio?: number;
  modelPrice?: number;
  quotaType?: number;
  completionRatio?: number;
}

export interface RelayGroupModels {
  group: string;
  ratio?: number;
  models: RelayModelInfo[];
}

export interface RelayApplyResult {
  app: string;
  ok: boolean;
  providerId?: string;
  error?: string;
}

export interface RelayTargetInstall {
  app: string;
  cliPath?: string;
  desktopApp?: string;
  desktopName?: string;
  desktopReadsCliConfig?: boolean;
  desktopCandidates?: string[];
  desktopUrl?: string;
}

export interface RelayToolInstallPlan {
  app: RelayTarget;
  source: string;
  command: string;
  docsUrl: string;
}

export interface RelayUpdateCheck {
  configured: boolean;
  version?: string;
}

export type RelayEnvCheckStatus = "ok" | "warn" | "error" | "unavailable";

export interface RelayEnvCheck {
  id: string;
  status: RelayEnvCheckStatus;
  detail?: string;
  reason?: string;
}

export interface RelayEnvFixPlan {
  id: string;
  supported: boolean;
  command?: string;
  source?: string;
  docsUrl?: string;
}

export interface RelayToken {
  id: number;
  name: string;
  key: string;
  status: number;
  group: string;
  createdTime: number;
  usedQuota: number;
}

// ── 钱包、充值与中转站账单用量 ─────────────────────────────────────────────
// 这些 DTO 只描述 Rust 适配层可以安全返回给 renderer 的字段。金额、订单
// 状态与 Token 口径由中转站提供，renderer 不自行换算或推断。
export interface RelayTopupAmountOption {
  amount: number;
  label?: string;
  creditAmount?: number;
  currency?: string;
  currencySymbol?: string;
}

export interface RelayTopupPaymentMethod {
  id: string;
  label?: string;
  enabled: boolean;
  description?: string;
}

export interface RelayTopupInfo {
  enabled: boolean;
  currency?: string;
  currencySymbol?: string;
  amountOptions?: Array<RelayTopupAmountOption | number>;
  payMethods?: RelayTopupPaymentMethod[];
  minAmount?: number;
  message?: string;
}

export type RelayTopupOrderStatus =
  | "created"
  | "pending"
  | "paid"
  | "crediting"
  | "credited"
  | "failed"
  | "expired"
  | "cancelled"
  | "refunded"
  | "unknown";

export interface RelayTopupQuote {
  amount: number;
  payAmount?: number;
  creditAmount?: number;
  currency?: string;
  currencySymbol?: string;
  expiresAt?: string | number;
}

export interface RelayTopupOrder {
  orderId?: string;
  tradeNo?: string;
  createdAt?: string;
  paidAt?: string;
  creditedAt?: string;
  amount?: number;
  payAmount?: number;
  creditAmount?: number;
  currency?: string;
  currencySymbol?: string;
  method?: string;
  status: RelayTopupOrderStatus;
  checkoutUrl?: string;
  checkoutMethod?: string;
  expiresAt?: string;
}

export interface RelayTopupHistory {
  items: RelayTopupOrder[];
  total?: number;
  isComplete?: boolean;
  nextCursor?: string;
}

export interface RelayUsageModelRow {
  detailRequestCount?: number;
  detailsReconciled?: boolean;
  modelId: string;
  displayName: string;
  billingModel?: string;
  group?: string;
  tokenAliasMasked?: string;
  requestCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  chargedQuota?: number;
  chargedAmount?: string;
  currency?: string;
  currencySymbol?: string;
  successCount?: number;
  failedCount?: number;
  successRate?: number;
  /** null means the server could not safely attribute the tool. */
  source?: string | null;
}

export interface RelayUsageOverview {
  start: string;
  end: string;
  timezone?: string;
  asOf?: string;
  isComplete: boolean;
  requestCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  chargedQuota?: number;
  chargedAmount?: string;
  currency?: string;
  currencySymbol?: string;
  dataDelaySeconds?: number;
  unavailableFields?: string[];
}

export interface RelayUsageBucket {
  timestamp: number;
  modelId: string;
  requestCount: number;
  totalTokens: number;
  chargedQuota: number;
}

export interface RelayUsageModels {
  buckets?: RelayUsageBucket[];
  detailsStatus?: "matched" | "unreconciled" | "incomplete" | "failed";
  items: RelayUsageModelRow[];
  total?: number;
  isComplete: boolean;
  asOf?: string;
  timezone?: string;
  unavailableFields?: string[];
  nextCursor?: string;
}

export interface RelayUsageQuery {
  start: string;
  end: string;
  timezone?: string;
  group?: string;
  modelName?: string;
  tokenName?: string;
  type?: string;
  cursor?: string;
  pageSize?: number;
}

// ── 重启目标工具 ────────────────────────────────────────────────────────
// renderer 只能回传 app / 后端签发的 targetId / 本次 operationId；
// 路径、PID、bundle id、shell 命令一律不可达。

export type RelayRestartReason =
  | "not_installed"
  | "platform_unsupported"
  | "config_not_shared"
  | "cli_session_unsafe"
  | "identity_unverified";

export interface RelayRestartCapability {
  app: RelayTarget;
  supported: boolean;
  installed: boolean;
  /** null = 无法安全判断（CLI 会话不做进程归属判定） */
  running: boolean | null;
  targetKind: "desktop" | "cli";
  targetId?: string;
  displayName?: string;
  readsCliConfig: boolean;
  reason?: RelayRestartReason;
}

export type RelayRestartStatus =
  | "restarted"
  | "not_running_started"
  | "cancelled"
  | "not_installed"
  | "unsupported"
  | "exit_refused"
  | "exit_timeout"
  | "launch_failed";

export interface RelayRestartResult {
  app: RelayTarget;
  targetId: string;
  status: RelayRestartStatus;
  reason?: string;
  exitedExistingProcess: boolean;
  startedNewProcess: boolean;
}

export type RelayRestartStage =
  | "checking"
  | "requesting_exit"
  | "waiting_for_exit"
  | "starting"
  | "done"
  | "failed";

export interface RelayRestartProgress {
  operationId: string;
  app: RelayTarget;
  stage: RelayRestartStage;
}

export const relayApi = {
  async login(
    baseUrl: string,
    username: string,
    password: string,
    remember = false,
  ): Promise<RelayAccountInfo> {
    return await invoke("relay_login", {
      baseUrl,
      username,
      password,
      remember,
    });
  },

  async savedLoginName(): Promise<string | null> {
    return invoke("relay_saved_login_name");
  },
  async listSavedLogins(): Promise<RelaySavedLogin[]> {
    return invoke("relay_list_saved_logins");
  },
  async loginSaved(savedId: string): Promise<RelayAccountInfo | null> {
    return invoke("relay_login_saved", { savedId });
  },
  async forgetLogin(savedId?: string): Promise<void> {
    return invoke("relay_forget_login", { savedId });
  },
  async getAccount(): Promise<RelayAccountInfo | null> {
    return await invoke("relay_get_account");
  },

  async refreshAccount(): Promise<RelayAccountInfo> {
    return await invoke("relay_refresh_account");
  },

  async getTopupInfo(): Promise<RelayTopupInfo> {
    return await invoke("relay_get_topup_info");
  },

  async openOfficialTopup(): Promise<void> {
    await invoke("relay_open_official_topup");
  },

  async calculateTopupAmount(
    method: string,
    amount: number,
  ): Promise<RelayTopupQuote> {
    return await invoke("relay_calculate_topup_amount", { method, amount });
  },

  async createTopupPayment(
    method: string,
    amount: number,
    clientRequestId: string,
  ): Promise<RelayTopupOrder> {
    return await invoke("relay_create_topup_payment", {
      method,
      amount,
      clientRequestId,
    });
  },

  async listTopupHistory(page = 1, pageSize = 20): Promise<RelayTopupHistory> {
    return await invoke("relay_list_topup_history", { page, pageSize });
  },

  async getUsageModels(query: RelayUsageQuery): Promise<RelayUsageModels> {
    return await invoke("relay_get_usage_models", { query });
  },

  async getUsageSummary(query: RelayUsageQuery): Promise<RelayUsageOverview> {
    return await invoke("relay_get_usage_summary", { query });
  },

  async logout(): Promise<boolean> {
    return await invoke("relay_logout");
  },

  async listGroups(): Promise<RelayGroup[]> {
    return await invoke("relay_list_groups");
  },

  async listModels(): Promise<RelayGroupModels[]> {
    const groups = await invoke<RelayGroupModels[]>("relay_list_models");
    return groups.map((group) => ({
      ...group,
      models: group.models.map((model) => ({
        ...model,
        tags: model.tags ?? [],
      })),
    }));
  },

  async applyModel(
    group: string,
    model: string,
    options?: RelayApplyOptions,
  ): Promise<RelayApplyResult[]> {
    return await invoke("relay_apply_model", { group, model, ...options });
  },

  async exportDiagnostics(filePath: string): Promise<{ filePath: string }> {
    return await invoke("relay_export_diagnostics", { filePath });
  },

  async setApplyApps(apps: RelayApplyApps): Promise<RelayAccountInfo> {
    return await invoke("relay_set_apply_apps", {
      claude: apps.claude,
      codex: apps.codex,
      gemini: apps.gemini,
    });
  },

  async setGroupTarget(
    group: string,
    target: RelayTarget | null,
  ): Promise<RelayAccountInfo> {
    return await invoke("relay_set_group_target", { group, target });
  },

  async listTokens(): Promise<RelayToken[]> {
    return await invoke("relay_list_tokens");
  },

  async detectTargetInstallations(): Promise<RelayTargetInstall[]> {
    return await invoke("relay_detect_target_installations");
  },

  async openDesktopDownload(app: RelayTarget): Promise<void> {
    await invoke("relay_open_desktop_download", { app });
  },

  async getToolInstallPlan(app: RelayTarget): Promise<RelayToolInstallPlan> {
    return await invoke("relay_get_tool_install_plan", { app });
  },

  async envCheck(): Promise<RelayEnvCheck[]> {
    return await invoke("relay_env_check");
  },

  async envFixPlan(checkId: string): Promise<RelayEnvFixPlan> {
    return await invoke("relay_env_fix_plan", { checkId });
  },

  async envFix(checkId: string): Promise<void> {
    await invoke("relay_env_fix", { checkId });
  },

  async checkUpdate(): Promise<RelayUpdateCheck> {
    return await invoke("relay_check_update");
  },

  async logFrontendError(message: string): Promise<void> {
    await invoke("relay_log_frontend_error", { message });
  },

  async launchTarget(app: RelayTarget, mode: "desktop" | "cli"): Promise<void> {
    return await invoke("relay_launch_target", { app, mode });
  },

  async getRestartCapabilities(): Promise<RelayRestartCapability[]> {
    return await invoke("relay_get_restart_capabilities");
  },

  async restartTarget(
    app: RelayTarget,
    targetId: string,
    operationId: string,
  ): Promise<RelayRestartResult> {
    return await invoke("relay_restart_target", { app, targetId, operationId });
  },
};

/** 给尚未配置的中转站分组生成一次性建议；模型名不参与路由。 */
export function inferRelayTargets(group: string): RelayTarget[] {
  const normalized = group.toLowerCase();
  if (normalized.includes("claude")) return ["claude"];
  if (normalized.includes("gemini")) return ["gemini"];
  return ["codex"];
}

/**
 * 按中转站 /api/status 返回的配置格式化额度。
 * 没有可信货币配置时保留原始 quota 单位，绝不猜测美元或人民币。
 */
export function formatRelayQuota(
  quota: number,
  config: RelayCurrencyConfig,
): string {
  const raw = new Intl.NumberFormat().format(quota);
  if (
    config.displayInCurrency === false ||
    config.quotaDisplayType === "TOKENS" ||
    (!config.currencySymbol?.trim() && !config.currencyCode?.trim()) ||
    !config.quotaPerUnit ||
    !Number.isFinite(config.quotaPerUnit) ||
    config.quotaPerUnit <= 0
  ) {
    return `${raw} quota`;
  }
  const rate =
    config.quotaDisplayType === "CUSTOM"
      ? config.customCurrencyExchangeRate
      : 1;
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0)
    return `${raw} quota`;
  const amount = (quota / config.quotaPerUnit) * rate;
  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(amount) > 0 && Math.abs(amount) < 1 ? 6 : 2,
  }).format(amount);
  const symbol = config.currencySymbol?.trim();
  if (symbol) return `${symbol}${formatted}`;
  const code = config.currencyCode?.trim();
  return code ? `${formatted} ${code}` : `${formatted} quota`;
}

/**
 * Display a server-calculated monetary value without treating an ISO currency
 * code as a prefix. The explicit server symbol wins; otherwise the code is a
 * suffix so values render as `10.50 CNY` rather than `CNY10.50`.
 */
export function formatRelayMoney(
  amount: string | number,
  config: Pick<RelayCurrencyConfig, "currencyCode" | "currencySymbol">,
): string {
  const value = String(amount).trim();
  if (!value) return "—";
  const symbol = config.currencySymbol?.trim();
  if (symbol) return value.startsWith(symbol) ? value : `${symbol}${value}`;
  const code = config.currencyCode?.trim();
  if (!code) return value;
  return value.toUpperCase().includes(code.toUpperCase())
    ? value
    : `${value} ${code}`;
}

/** @deprecated 仅为旧调用方保留；新 UI 必须使用 formatRelayQuota。 */
export function quotaToUsd(quota: number): number {
  return quota / 500000;
}
