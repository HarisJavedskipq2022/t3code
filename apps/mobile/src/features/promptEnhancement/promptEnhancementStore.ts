import { useAtomValue } from "@effect/atom-react";
import {
  enhancedDraftText,
  type PromptEnhancementEntry,
  promptEnhancementStatus,
} from "@t3tools/client-runtime/prompt-enhancement";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../state/atom-registry";
import {
  composerDraftsAtom,
  getComposerDraftSnapshot,
  setComposerDraftText,
} from "../../state/use-composer-drafts";

/** By composer draft key. Memory only: a restart drops the request, so it drops the wait too. */
const promptEnhancementsAtom = Atom.make<Readonly<Record<string, PromptEnhancementEntry>>>({}).pipe(
  Atom.keepAlive,
);

function setEntry(draftKey: string, entry: PromptEnhancementEntry | undefined) {
  const { [draftKey]: _previous, ...entries } = appAtomRegistry.get(promptEnhancementsAtom);
  appAtomRegistry.set(
    promptEnhancementsAtom,
    entry === undefined ? entries : { ...entries, [draftKey]: entry },
  );
}

export type PromptEnhancementOutcome =
  | { readonly type: "applied" }
  | { readonly type: "edited" }
  | { readonly type: "failed"; readonly detail: string };

/**
 * Rewrites the draft in place. The rewrite lands only if the draft is unchanged by then, and stays
 * undoable until the user edits it.
 */
export async function runPromptEnhancement(input: {
  readonly draftKey: string;
  /** The part of the draft the rewrite replaces; the whole draft when omitted. */
  readonly replace?: string;
  readonly request: () => Promise<{ readonly prompt: string } | { readonly error: string }>;
}): Promise<PromptEnhancementOutcome> {
  const original = getComposerDraftSnapshot(input.draftKey).text;
  const replace = input.replace ?? original;
  setEntry(input.draftKey, { state: "running", original, replace });
  const result = await input.request();
  if ("error" in result) {
    setEntry(input.draftKey, undefined);
    return { type: "failed", detail: result.error };
  }
  const next = enhancedDraftText({
    current: getComposerDraftSnapshot(input.draftKey).text,
    original,
    replace,
    enhanced: result.prompt,
  });
  if (next === null) {
    setEntry(input.draftKey, undefined);
    return { type: "edited" };
  }
  setComposerDraftText(input.draftKey, next);
  setEntry(input.draftKey, { state: "done", original, enhanced: next });
  return { type: "applied" };
}

export function undoPromptEnhancement(draftKey: string): void {
  const entry = appAtomRegistry.get(promptEnhancementsAtom)[draftKey];
  const current = getComposerDraftSnapshot(draftKey).text;
  if (entry === undefined || promptEnhancementStatus(entry, current) !== "undoable") return;
  setComposerDraftText(draftKey, entry.original);
  setEntry(draftKey, undefined);
}

export function usePromptEnhancementStatus(draftKey: string | null) {
  const entry = useAtomValue(promptEnhancementsAtom, (entries) =>
    draftKey === null ? undefined : entries[draftKey],
  );
  return useAtomValue(composerDraftsAtom, (drafts) =>
    promptEnhancementStatus(entry, draftKey === null ? "" : (drafts[draftKey]?.text ?? "")),
  );
}
