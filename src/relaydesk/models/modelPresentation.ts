import type { RelayGroupModels } from "@/lib/api/relay";

export const uniqueModelCount = (groups: RelayGroupModels[]) =>
  new Set(groups.flatMap((g) => g.models.map((m) => m.id))).size;
