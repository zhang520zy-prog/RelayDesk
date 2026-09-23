import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  relayApi,
  type RelayAccountInfo,
  type RelayApplyApps,
  type RelayAppliedModel,
  type RelaySavedLogin,
  type RelayTarget,
} from "@/lib/api/relay";
import { relayErrorKey } from "./relayErrors";

export const accountKey = ["relay", "account"] as const;
export function useRelaySession() {
  const client = useQueryClient();
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [groupTargetSaving, setGroupTargetSaving] = useState<string | null>(
    null,
  );
  const refreshingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef<symbol | null>(null);
  const groupQueue = useRef<Promise<void>>(Promise.resolve());
  const groupQueueLock = useRef<symbol | null>(null);
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
  const savedLoginQuery = useQuery<RelaySavedLogin[]>({
    queryKey: ["relay", "saved-logins"],
    queryFn: () => relayApi.listSavedLogins(),
    enabled: !account && !accountQuery.isPending,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
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
        locked.current = null;
        groupQueue.current = Promise.resolve();
        groupQueueLock.current = null;
        refreshingRef.current = false;
        setBusy(false);
        setRefreshing(false);
        setGroupTargetSaving(null);
        setExpired(true);
        void client.cancelQueries({ queryKey: ["relay"] });
        client.removeQueries({ queryKey: ["relay", "models"] });
        client.removeQueries({ queryKey: ["relay", "groups"] });
        void client.cancelQueries({ queryKey: ["relaydesk"] });
        client.removeQueries({ queryKey: ["relaydesk"] });
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
    if (refreshingRef.current) return false;
    const epoch = generation.current;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const next = await relayApi.refreshAccount();
      if (epoch === generation.current) {
        client.setQueryData(accountKey, next);
        setError(null);
        return true;
      }
      return false;
    } catch (e) {
      if (epoch === generation.current) handleError(e);
      return false;
    } finally {
      if (epoch === generation.current) {
        refreshingRef.current = false;
        setRefreshing(false);
      }
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
    if (locked.current || refreshingRef.current) return;
    const epoch = generation.current;
    const lock = Symbol();
    locked.current = lock;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (e) {
      if (epoch === generation.current) handleError(e);
    } finally {
      if (locked.current === lock) {
        locked.current = null;
        setBusy(false);
      }
    }
  }
  async function login(
    baseUrl: string,
    username: string,
    password: string,
    remember = false,
  ) {
    await run(async () => {
      const epoch = generation.current;
      const next = await relayApi.login(baseUrl, username, password, remember);
      if (epoch !== generation.current) return;
      generation.current++;
      await client.cancelQueries({ queryKey: ["relay"] });
      await client.cancelQueries({ queryKey: ["relaydesk"] });
      client.removeQueries({ queryKey: ["relaydesk"] });
      client.removeQueries({ queryKey: ["relay", "models"] });
      client.removeQueries({ queryKey: ["relay", "groups"] });
      client.removeQueries({ queryKey: ["relay", "saved-logins"] });
      refreshedIdentity.current = `${next.baseUrl}:${next.userId ?? next.username}`;
      client.setQueryData(accountKey, next);
      setExpired(false);
      if (remember && next.remembered === false) setError("rememberNotSaved");
    });
  }
  async function loginSaved(savedId: string) {
    await run(async () => {
      const epoch = generation.current;
      let next: RelayAccountInfo | null;
      try {
        next = await relayApi.loginSaved(savedId);
      } catch (e) {
        if (relayErrorKey(e) === "savedLoginExpired")
          await savedLoginQuery.refetch();
        throw e;
      }
      if (epoch !== generation.current) return;
      if (!next) throw new Error("relay.saved_login_missing");
      generation.current++;
      await client.cancelQueries({ queryKey: ["relay"] });
      await client.cancelQueries({ queryKey: ["relaydesk"] });
      client.removeQueries({ queryKey: ["relaydesk"] });
      client.removeQueries({ queryKey: ["relay", "models"] });
      client.removeQueries({ queryKey: ["relay", "groups"] });
      client.removeQueries({ queryKey: ["relay", "saved-logins"] });
      refreshedIdentity.current = `${next.baseUrl}:${next.userId ?? next.username}`;
      client.setQueryData(accountKey, next);
      setExpired(false);
    });
  }
  async function forgetSavedLogin(savedId: string) {
    await run(async () => {
      await relayApi.forgetLogin(savedId);
      await savedLoginQuery.refetch();
    });
  }
  async function logout() {
    await run(async () => {
      const epoch = generation.current;
      const ok = await relayApi.logout();
      if (epoch !== generation.current) return;
      if (!ok) throw new Error("relay.logout_failed");
      generation.current++;
      await client.cancelQueries({ queryKey: ["relay"] });
      await client.cancelQueries({ queryKey: ["relaydesk"] });
      client.removeQueries({ queryKey: ["relaydesk"] });
      client.removeQueries({ queryKey: ["relay", "models"] });
      client.removeQueries({ queryKey: ["relay", "groups"] });
      client.removeQueries({ queryKey: ["relay", "saved-logins"] });
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
  async function setGroupTarget(
    group: string,
    target: RelayTarget | null,
  ): Promise<boolean> {
    if (
      (locked.current && locked.current !== groupQueueLock.current) ||
      refreshingRef.current ||
      !account
    )
      return false;
    const epoch = generation.current;
    const lock = groupQueueLock.current ?? Symbol();
    groupQueueLock.current = lock;
    locked.current = lock;
    setGroupTargetSaving(group);
    // Rows can be edited independently, but full-account responses must arrive
    // in write order. An expired session discards its queued work before IPC.
    const previous = groupQueue.current;
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    groupQueue.current = done;
    try {
      await previous;
      if (epoch !== generation.current) return false;
      const next = await relayApi.setGroupTarget(group, target);
      if (epoch !== generation.current) return false;
      client.setQueryData(accountKey, next);
      return true;
    } catch (e) {
      // Ordinary save failures belong to the row; expired sessions still sign out.
      if (epoch === generation.current && relayErrorKey(e) === "expired")
        handleError(e);
      return false;
    } finally {
      release();
      if (groupQueue.current === done && locked.current === lock) {
        locked.current = null;
        groupQueueLock.current = null;
        setGroupTargetSaving(null);
      }
    }
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
    groupTargetSaving,
    error,
    expired,
    login,
    savedLoginQuery,
    loginSaved,
    forgetSavedLogin,
    logout,
    setApps,
    setGroupTarget,
    refresh,
    refreshAccount,
    applied,
    handleError,
  };
}
