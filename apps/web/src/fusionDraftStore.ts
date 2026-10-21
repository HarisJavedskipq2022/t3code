import type {
  ModelSelection,
  OrchestrationV2FusionRole,
  OrchestrationV2ThreadFusion,
} from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

interface FusionDraftState {
  /**
   * The Fusion choice per composer target (see composerTargetKey). Absent means
   * untouched: the composer shows the thread's own pairing and sends nothing.
   */
  byTargetKey: Record<string, OrchestrationV2ThreadFusion | null>;
  /** The lineup to offer when Fusion is next turned on. */
  lastSidekick: ModelSelection | null;
  lastRoles: ReadonlyArray<OrchestrationV2FusionRole>;
  setFusion: (targetKey: string, fusion: OrchestrationV2ThreadFusion | null) => void;
}

export const useFusionDraftStore = create<FusionDraftState>()(
  persist(
    (set) => ({
      byTargetKey: {},
      lastSidekick: null,
      lastRoles: [],
      setFusion: (targetKey, fusion) =>
        set((state) => ({
          byTargetKey: { ...state.byTargetKey, [targetKey]: fusion },
          lastSidekick: fusion?.sidekick ?? state.lastSidekick,
          lastRoles: fusion === null ? state.lastRoles : (fusion.roles ?? []),
        })),
    }),
    {
      name: "t3code:fusion-draft:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
    },
  ),
);

/** The pairing the composer shows: the user's choice, else the thread's own. */
export function resolveComposerFusion(
  draftFusion: OrchestrationV2ThreadFusion | null | undefined,
  threadFusion: OrchestrationV2ThreadFusion | null | undefined,
): OrchestrationV2ThreadFusion | null {
  return draftFusion === undefined ? (threadFusion ?? null) : draftFusion;
}
