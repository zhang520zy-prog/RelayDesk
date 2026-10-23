import {
  inferDeployTools,
  inferRelayTargets,
  type RelayGroupModels,
  type RelayTarget,
} from "@/lib/api/relay";

export const uniqueModelCount = (groups: RelayGroupModels[]) =>
  new Set(groups.flatMap((g) => g.models.map((m) => m.id))).size;

export type ModelProgram = RelayTarget | "devin";

/** 分组是否归属某 AI 程序：组名或组内任一模型名命中该家族。
 *  devin 走 deploy-only 家族（inferDeployTools）；其余走 inferRelayTargets。
 *  组名/模型名都不可识别的分组不属于任何程序筛选。 */
export function groupMatchesProgram(
  group: RelayGroupModels,
  program: ModelProgram,
): boolean {
  if (program === "devin") {
    return (
      inferDeployTools(group.group).length > 0 ||
      group.models.some((m) =>
        inferDeployTools(group.group, m.id).includes("devin"),
      )
    );
  }
  return (
    inferRelayTargets(group.group).includes(program) ||
    group.models.some((m) =>
      inferRelayTargets(group.group, m.id).includes(program),
    )
  );
}
