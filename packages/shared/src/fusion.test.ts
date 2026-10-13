import {
  NodeId,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadFusion,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { findFusionSidekick } from "./fusion.ts";

const commandCode = ProviderInstanceId.make("acpRegistry_command_code");
const fusion: OrchestrationV2ThreadFusion = {
  sidekick: { instanceId: commandCode, model: "deepseek/deepseek-v4.1-flash" },
};

function subagent(overrides: Partial<OrchestrationV2Subagent>): OrchestrationV2Subagent {
  const now = DateTime.makeUnsafe("2026-10-12T12:00:00Z");
  return {
    id: NodeId.make("node-sidekick"),
    threadId: ThreadId.make("thread-lead"),
    runId: null,
    parentNodeId: NodeId.make("node-lead"),
    origin: "app_owned",
    createdBy: "agent",
    driver: ProviderDriverKind.make("acpRegistry"),
    providerInstanceId: commandCode,
    providerThreadId: null,
    childThreadId: ThreadId.make("thread-sidekick"),
    nativeTaskRef: null,
    prompt: "Implement step 1",
    title: null,
    model: fusion.sidekick.model,
    modelSelection: fusion.sidekick,
    status: "completed",
    result: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("findFusionSidekick", () => {
  it("returns the latest app-owned child running the sidekick model, whatever its effort", () => {
    const older = subagent({ childThreadId: ThreadId.make("thread-older") });
    const latest = subagent({
      childThreadId: ThreadId.make("thread-latest"),
      modelSelection: { ...fusion.sidekick, options: [{ id: "effort", value: "low" }] },
    });
    expect(findFusionSidekick([older, latest], fusion)?.childThreadId).toBe("thread-latest");
  });

  it("matches delegate_task records, which carry the model slug but no modelSelection", () => {
    const { modelSelection: _omitted, ...delegated } = subagent({});
    expect(findFusionSidekick([delegated], fusion)).toBe(delegated);
  });

  it("skips native, other-model, other-instance, and thread-less children", () => {
    expect(
      findFusionSidekick(
        [
          subagent({ origin: "provider_native" }),
          subagent({ modelSelection: { ...fusion.sidekick, model: "kimi-k3" } }),
          subagent({ providerInstanceId: ProviderInstanceId.make("codex") }),
          subagent({ childThreadId: null }),
        ],
        fusion,
      ),
    ).toBeNull();
  });

  it("limits the match to the given statuses", () => {
    const failed = subagent({ status: "failed" });
    expect(findFusionSidekick([failed], fusion)).toBe(failed);
    expect(findFusionSidekick([failed], fusion, new Set(["idle", "completed"]))).toBeNull();
  });
});
