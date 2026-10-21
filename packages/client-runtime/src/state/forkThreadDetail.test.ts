import {
  EnvironmentId,
  NodeId,
  type OrchestrationV2ThreadProjection,
  ProviderDriverKind,
  RunId,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import { v2Now, v2Projection } from "./orchestrationV2TestFixtures.ts";
import { createEnvironmentThreadDetailAtoms } from "./threadDetail.ts";
import { EMPTY_THREAD_HISTORY_META } from "./threadHistoryMerge.ts";
import type { EnvironmentThreadState } from "./threads.ts";

const ref: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-detail"),
  threadId: ThreadId.make(v2Projection.thread.id),
};

function threadState(
  partial: Pick<EnvironmentThreadState, "data" | "status" | "error">,
): EnvironmentThreadState {
  return { ...partial, history: EMPTY_THREAD_HISTORY_META };
}

it("finds a Fusion lead's sidekick and follows pairing changes", () => {
  const sidekickSelection = { instanceId: v2Projection.thread.providerInstanceId, model: "luna" };
  const sidekick = {
    id: NodeId.make("subagent-sidekick"),
    threadId: v2Projection.thread.id,
    runId: RunId.make("active-run"),
    parentNodeId: NodeId.make("root"),
    origin: "app_owned" as const,
    createdBy: "agent" as const,
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId: v2Projection.thread.providerInstanceId,
    providerThreadId: null,
    childThreadId: ThreadId.make("thread-sidekick"),
    nativeTaskRef: null,
    prompt: "Write the code",
    title: null,
    model: "luna",
    modelSelection: sidekickSelection,
    status: "failed" as const,
    result: null,
    startedAt: v2Now,
    completedAt: v2Now,
    updatedAt: v2Now,
  };
  const withFusion = (fusion: OrchestrationV2ThreadProjection["thread"]["fusion"]) =>
    AsyncResult.success(
      threadState({
        data: Option.some({
          ...v2Projection,
          thread: { ...v2Projection.thread, fusion },
          subagents: [sidekick],
        }),
        status: "live",
        error: Option.none(),
      }),
    );
  const source = Atom.make(withFusion({ sidekick: sidekickSelection }));
  const details = createEnvironmentThreadDetailAtoms(() => source);
  const registry = AtomRegistry.make();
  const dispose = registry.mount(details.fusionSidekickAtom(ref));

  // A failed sidekick still counts, so the composer can say it stopped.
  expect(registry.get(details.fusionSidekickAtom(ref))).toBe(sidekick);
  registry.set(source, withFusion({ sidekick: { ...sidekickSelection, model: "sol" } }));
  expect(registry.get(details.fusionSidekickAtom(ref))).toBeNull();
  registry.set(source, withFusion(null));
  expect(registry.get(details.fusionSidekickAtom(ref))).toBeNull();
  dispose();
  registry.dispose();
});
