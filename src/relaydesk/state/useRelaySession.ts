import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  relayApi,
  type RelayAccountInfo,
  type RelayApplyApps,
  type RelayAppliedModel,
} from "@/lib/api/relay";
import { relayErrorKey } from "./relayErrors";

export const accountKey = ["relay", "account"] as const;
export function useRelaySession() {
  const client = useQueryClient();
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  const refreshedIdentity = useRef("");
  const accountQuery = useQuery({
    queryKey: accountKey,
    queryFn: async ({ signal }) => {
      const result = await relayApi.getAccount();
      signal.throwIfAborted();
      return result;
    },
    enabled: !expired,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const account = expired ? null : accountQuery.data;
  const modelsQuery = useQuery({
    queryKey: ["relay", "models"],
    queryFn: async ({ signal }) => {
      const result = await relayApi.listModels();
      signal.throwIfAborted();
      return result;
    },
    enabled: !!account,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const groupsQuery = useQuery({
    queryKey: ["relay", "groups"],
    queryFn: async ({ signal }) => {
      const result = await relayApi.listGroups();
      signal.throwIfAborted();
      return result;
    },
    enabled: !!account,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const handleError = useCallback(
    (e: unknown) => {
      const key = relayErrorKey(e);
      setError(key);
      if (key === "expired") {
        generation.current++;
        setExpired(true);
        void client.cancelQueries({ queryKey: ["relay"] });
        client.removeQueries({ queryKey: ["relay", "models"] });
        client.removeQueries({ queryKey: ["relay", "groups"] });
        client.setQueryData(accountKey, null);
      }
      return key;
    },
    [client],
  );
  useEffect(() => {
    const e = modelsQuery.error ?? groupsQuery.error;
    if (e && relayErrorKey(e) === "expired") handleError(e);
  }, [modelsQuery.error, groupsQuery.error, handleError]);

  const refreshAccount = useCallback(async () => {
    const epoch = generation.current;
    setRefreshing(true);
    try {
      const next = await relayApi.refreshAccount();
      if (epoch === generation.current) {
        client.setQueryData(accountKey, next);
        setError(null);
      }
    } catch (e) {
      if (epoch === generation.current) handleError(e);
    } finally {
      setRefreshing(false);
    }
  }, [client, handleError]);
  useEffect(() => {
    if (!account) return;
    const identity = `${account.baseUrl}:${account.userId ?? account.username}`;
    if (refreshedIdentity.current === identity) return;
    refreshedIdentity.current = identity;
    void refreshAccount();
  }, [account, refreshAccount]);

  async function run(operation: () => Promise<void>) {
    if (locked.current) return;
    const epoch = generation.current;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (e) {
      if (epoch === generation.current) handleError(e);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function login(baseUrl: string, username: string, password: string) {
    await run(async () => {
      const next = await relayApi.login(baseUrl, username, password);
      generation.current++;
      await client.cancelQueries({ queryKey: ["relay"] });
      client.removeQueries({ queryKey: ["relay", "models"] });
      client.removeQueries({ queryKey: ["relay", "groups"] });
      refreshedIdentity.current = `${next.baseUrl}:${next.userId ?? next.username}`;
      client.setQueryData(accountKey, next);
      setExpired(false);
    });
  }
  async function logout() {
    await run(async () => {
      const ok = await relayApi.logout();
      if (!ok) throw new Error("relay.logout_failed");
      generation.current++;
      await client.cancelQueries({ queryKey: ["relay"] });
      client.removeQueries({ queryKey: ["relay", "models"] });
      client.removeQueries({ queryKey: ["relay", "groups"] });
      client.setQueryData(accountKey, null);
      refreshedIdentity.current = "";
    });
  }
  async function setApps(apps: RelayApplyApps) {
    await run(async () => {
      const epoch = generation.current;
      const next = await relayApi.setApplyApps(apps);
      if (epoch === generation.current) client.setQueryData(accountKey, next);
    });
  }
  async function refresh() {
    await run(async () => {
      await Promise.all([
        refreshAccount(),
        modelsQuery.refetch(),
        groupsQuery.refetch(),
      ]);
    });
  }
  async function applied(model: RelayAppliedModel) {
    const epoch = generation.current;
    client.setQueryData<RelayAccountInfo | null>(accountKey, (old) =>
      old ? { ...old, lastApplied: model } : old,
    );
    try {
      const next = await relayApi.getAccount();
      if (epoch === generation.current) client.setQueryData(accountKey, next);
    } catch {
      if (epoch === generation.current) setError("accountRefreshFailed");
    }
  }
  return {
    account,
    generation,
    accountQuery,
    modelsQuery,
    groupsQuery,
    busy: busy || refreshing,
    error,
    expired,
    login,
    logout,
    setApps,
    refresh,
    applied,
    handleError,
  };
}
