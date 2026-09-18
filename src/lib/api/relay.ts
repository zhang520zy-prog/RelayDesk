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
  targetApp?: RelayTarget;
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

export interface RelayAccountInfo {
  baseUrl: string;
  userId?: number;
  username: string;
  /** 剩余额度（原始 quota，500000 = $1） */
  quota: number;
  usedQuota: number;
  group: string;
  applyApps: RelayApplyApps;
  lastApplied?: RelayAppliedModel;
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

export interface RelayToken {
  id: number;
  name: string;
  key: string;
  status: number;
  group: string;
  createdTime: number;
  usedQuota: number;
}

export const relayApi = {
  async login(
    baseUrl: string,
    username: string,
    password: string,
  ): Promise<RelayAccountInfo> {
    return await invoke("relay_login", { baseUrl, username, password });
  },

  async getAccount(): Promise<RelayAccountInfo | null> {
    return await invoke("relay_get_account");
  },

  async refreshAccount(): Promise<RelayAccountInfo> {
    return await invoke("relay_refresh_account");
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

  async listTokens(): Promise<RelayToken[]> {
    return await invoke("relay_list_tokens");
  },
};

/** quota（500000 = $1）→ 美元金额 */
export function quotaToUsd(quota: number): number {
  return quota / 500000;
}
