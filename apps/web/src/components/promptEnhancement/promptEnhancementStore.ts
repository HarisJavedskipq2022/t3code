import {
  enhancedDraftText,
  type PromptEnhancementEntry,
  promptEnhancementStatus,
} from "@t3tools/client-runtime/prompt-enhancement";
import { create } from "zustand";

import {
  type ComposerThreadTarget,
  resolveComposerDraftKey,
  useComposerDraftStore,
} from "../../composerDraftStore";

/** By composer draft key. Memory only: a reload drops the request, so it drops the wait too. */
const usePromptEnhancements = create<Readonly<Record<string, PromptEnhancementEntry>>>(() => ({}));

type ComposerState = ReturnType<typeof useComposerDraftStore.getState>;

function promptAt(state: ComposerState, key: string | null): string {
  return key === null ? "" : (state.draftsByThreadKey[key]?.prompt ?? "");
}

function forget(key: string) {
  usePromptEnhancements.setState(({ [key]: _done, ...entries }) => entries, true);
}

export type PromptEnhancementOutcome =
  | { readonly type: "applied"; readonly readCode: boolean }
  | { readonly type: "edited" }
  | { readonly type: "failed"; readonly detail: string };

/**
 * Rewrites the draft in place. The rewrite lands only if the draft is unchanged by then, and stays
 * undoable until the user edits it.
 */
export async function runPromptEnhancement(input: {
  readonly target: ComposerThreadTarget;
  /** The part of the draft the rewrite replaces; the whole draft when omitted. */
  readonly replace?: string;
  readonly request: () => Promise<
    { readonly prompt: string; readonly readCode: boolean } | { readonly error: string }
  >;
}): Promise<PromptEnhancementOutcome | null> {
  const store = useComposerDraftStore.getState();
  const key = resolveComposerDraftKey(store, input.target);
  if (key === null) return null;
  const original = promptAt(store, key);
  usePromptEnhancements.setState({
    [key]: { state: "running", original, replace: input.replace ?? original },
  });
  const result = await input.request();
  if ("error" in result) {
    forget(key);
    return { type: "failed", detail: result.error };
  }
  const latest = useComposerDraftStore.getState();
  const next = enhancedDraftText({
    current: promptAt(latest, key),
    original,
    replace: input.replace ?? original,
    enhanced: result.prompt,
  });
  if (next === null) {
    forget(key);
    return { type: "edited" };
  }
  latest.setPrompt(input.target, next);
  usePromptEnhancements.setState({
    [key]: { state: "done", original, enhanced: next },
  });
  return { type: "applied", readCode: result.readCode };
}

export function readComposerPrompt(target: ComposerThreadTarget): string {
  const store = useComposerDraftStore.getState();
  return promptAt(store, resolveComposerDraftKey(store, target));
}

export function undoPromptEnhancement(target: ComposerThreadTarget): void {
  const store = useComposerDraftStore.getState();
  const key = resolveComposerDraftKey(store, target);
  if (key === null) return;
  const entry = usePromptEnhancements.getState()[key];
  if (promptEnhancementStatus(entry, promptAt(store, key)) !== "undoable" || !entry) return;
  store.setPrompt(target, entry.original);
  forget(key);
}

export function usePromptEnhancementStatus(target: ComposerThreadTarget) {
  const key = useComposerDraftStore((state) => resolveComposerDraftKey(state, target));
  const entry = usePromptEnhancements((entries) => (key === null ? undefined : entries[key]));
  return useComposerDraftStore((state) => promptEnhancementStatus(entry, promptAt(state, key)));
}
