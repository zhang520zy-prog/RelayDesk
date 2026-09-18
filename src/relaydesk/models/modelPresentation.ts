import type {
  RelayAppliedModel,
  RelayGroupModels,
  RelayModelInfo,
} from "@/lib/api/relay";
export interface ModelChoice {
  group: string;
  ratio?: number;
  model: RelayModelInfo;
}
export function modelChoices(
  groups: RelayGroupModels[],
  group: string,
  search: string,
  current?: RelayAppliedModel,
): ModelChoice[] {
  const query = search.trim().toLocaleLowerCase();
  return groups
    .flatMap((g) =>
      g.models.map((model) => ({ group: g.group, ratio: g.ratio, model })),
    )
    .filter(
      (row) =>
        (!group || row.group === group) &&
        (!query ||
          [
            row.model.id,
            row.model.description ?? "",
            ...(row.model.tags ?? []),
          ].some((value) => value.toLocaleLowerCase().includes(query))),
    )
    .sort((a, b) => {
      const activeA =
        a.group === current?.group && a.model.id === current.model;
      const activeB =
        b.group === current?.group && b.model.id === current.model;
      return (
        Number(activeB) - Number(activeA) ||
        a.model.id.localeCompare(b.model.id) ||
        a.group.localeCompare(b.group)
      );
    });
}
export const uniqueModelCount = (groups: RelayGroupModels[]) =>
  new Set(groups.flatMap((g) => g.models.map((m) => m.id))).size;
