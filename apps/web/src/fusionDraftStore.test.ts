import { ProviderInstanceId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { resolveComposerFusion, useFusionDraftStore } from "./fusionDraftStore";

const sidekick = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" };
const threadFusion = { sidekick: { instanceId: ProviderInstanceId.make("cursor"), model: "k3" } };

describe("resolveComposerFusion", () => {
  it("shows the thread's pairing until the user chooses, including turning it off", () => {
    expect(resolveComposerFusion(undefined, threadFusion)).toBe(threadFusion);
    expect(resolveComposerFusion(undefined, undefined)).toBeNull();
    expect(resolveComposerFusion(null, threadFusion)).toBeNull();
    expect(resolveComposerFusion({ sidekick }, threadFusion)).toEqual({ sidekick });
  });
});

describe("useFusionDraftStore", () => {
  beforeEach(() => useFusionDraftStore.setState({ byTargetKey: {}, lastSidekick: null }));

  it("keeps choices per composer target and remembers the last sidekick after turning off", () => {
    const { setFusion } = useFusionDraftStore.getState();
    setFusion("thread-a", { sidekick });
    setFusion("thread-b", null);
    setFusion("thread-a", null);

    const state = useFusionDraftStore.getState();
    expect(state.byTargetKey).toEqual({ "thread-a": null, "thread-b": null });
    expect(state.lastSidekick).toEqual(sidekick);
  });
});
