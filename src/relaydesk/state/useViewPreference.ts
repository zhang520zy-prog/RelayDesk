import { useState } from "react";

// Only fixed, non-sensitive display choices belong here. Never session/account data.
export function useViewPreference<T extends string>(
  key: string,
  initial: T,
  allowed: readonly T[],
) {
  const storageKey = `relaydesk.view.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey) as T;
      return allowed.includes(stored) ? stored : initial;
    } catch {
      return initial;
    }
  });
  const update = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Preferences remain usable when storage is unavailable.
    }
  };
  return [value, update] as const;
}
