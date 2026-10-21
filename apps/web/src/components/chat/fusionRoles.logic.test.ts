import {
  type ModelSelection,
  type OrchestrationV2ThreadFusion,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { addFusionRole, fusionModelOwner, fusionRoleNameProblem } from "./fusionRoles.logic";

const codex = ProviderInstanceId.make("codex");
const model = (slug: string): ModelSelection => ({ instanceId: codex, model: slug });
const fusion: OrchestrationV2ThreadFusion = {
  sidekick: model("gpt-6-luna"),
  roles: [{ name: "ui", useFor: "", sidekick: model("gpt-6-mini") }],
};

describe("fusionModelOwner", () => {
  it("names the other sidekick already running a model, ignoring the one being changed", () => {
    expect(fusionModelOwner(fusion, model("gpt-6-luna"), 0)).toBe("the default sidekick");
    expect(fusionModelOwner(fusion, model("gpt-6-mini"), null)).toBe('the "ui" sidekick');
    expect(fusionModelOwner(fusion, model("gpt-6-mini"), 0)).toBeNull();
    expect(fusionModelOwner(fusion, model("gpt-6-sol"), null)).toBeNull();
  });
});

describe("fusionRoleNameProblem", () => {
  it("wants a name no other role has", () => {
    expect(fusionRoleNameProblem(fusion, "  ", 0)).toBe("A sidekick needs a name.");
    expect(fusionRoleNameProblem(fusion, "UI ", 1)).toContain("already called");
    expect(fusionRoleNameProblem(fusion, "UI", 0)).toBeNull();
    expect(fusionRoleNameProblem(fusion, "x".repeat(41), 0)).toContain("under 40");
  });
});

describe("addFusionRole", () => {
  it("adds a role on the first model no sidekick runs, with a free name", () => {
    const next = addFusionRole({ ...fusion, roles: [{ ...fusion.roles![0]!, name: "role 2" }] }, [
      model("gpt-6-luna"),
      model("gpt-6-mini"),
      model("gpt-6-sol"),
    ]);
    expect(next?.roles?.[1]).toEqual({ name: "role 3", useFor: "", sidekick: model("gpt-6-sol") });
  });

  it("adds nothing when every model is taken or roles are full", () => {
    expect(addFusionRole(fusion, [model("gpt-6-luna"), model("gpt-6-mini")])).toBeNull();
    const full: OrchestrationV2ThreadFusion = {
      sidekick: model("a"),
      roles: ["b", "c", "d"].map((slug) => ({ name: slug, useFor: "", sidekick: model(slug) })),
    };
    expect(addFusionRole(full, [model("e")])).toBeNull();
  });
});
