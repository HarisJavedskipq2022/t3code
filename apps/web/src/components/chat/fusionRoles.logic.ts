import {
  MAX_FUSION_ROLES,
  type ModelSelection,
  type OrchestrationV2ThreadFusion,
} from "@t3tools/contracts";

const ROLE_NAME_MAX_LENGTH = 40;

function sameModel(a: ModelSelection, b: ModelSelection): boolean {
  return a.instanceId === b.instanceId && a.model === b.model;
}

/**
 * Which other sidekick already runs this model, as words for a note, or null
 * when it is free. `roleIndex` is the role being changed; null is the default.
 */
export function fusionModelOwner(
  fusion: OrchestrationV2ThreadFusion,
  selection: ModelSelection,
  roleIndex: number | null,
): string | null {
  if (roleIndex !== null && sameModel(fusion.sidekick, selection)) return "the default sidekick";
  const owner = (fusion.roles ?? []).find(
    (role, index) => index !== roleIndex && sameModel(role.sidekick, selection),
  );
  return owner ? `the "${owner.name}" sidekick` : null;
}

/** Why a role can't take this name, or null when it can. */
export function fusionRoleNameProblem(
  fusion: OrchestrationV2ThreadFusion,
  name: string,
  roleIndex: number,
): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "A sidekick needs a name.";
  if (trimmed.length > ROLE_NAME_MAX_LENGTH) {
    return `Keep names under ${ROLE_NAME_MAX_LENGTH} characters.`;
  }
  const taken = (fusion.roles ?? []).some(
    (role, index) => index !== roleIndex && role.name.toLowerCase() === trimmed.toLowerCase(),
  );
  return taken ? `Another sidekick is already called "${trimmed}".` : null;
}

/**
 * The pairing with one more role, on the first candidate model no sidekick
 * runs yet; null when roles are full or every candidate is taken.
 */
export function addFusionRole(
  fusion: OrchestrationV2ThreadFusion,
  candidates: Iterable<ModelSelection>,
): OrchestrationV2ThreadFusion | null {
  const roles = fusion.roles ?? [];
  if (roles.length >= MAX_FUSION_ROLES) return null;
  let sidekick: ModelSelection | null = null;
  for (const candidate of candidates) {
    if (fusionModelOwner(fusion, candidate, -1) === null) {
      sidekick = candidate;
      break;
    }
  }
  if (sidekick === null) return null;
  let number = roles.length + 1;
  while (roles.some((role) => role.name.toLowerCase() === `role ${number}`)) number += 1;
  return { ...fusion, roles: [...roles, { name: `role ${number}`, useFor: "", sidekick }] };
}
