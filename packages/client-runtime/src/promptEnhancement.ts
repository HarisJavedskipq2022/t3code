/**
 * A composer draft's rewrite. `original` is the whole draft when it started and `replace` the part
 * the rewrite stands in for: all of it for Enhance, the ticket template for a ticket draft.
 */
export type PromptEnhancementEntry =
  | {
      readonly state: "running";
      readonly original: string;
      readonly replace: string;
    }
  | {
      readonly state: "done";
      readonly original: string;
      readonly enhanced: string;
    };

export type PromptEnhancementStatus = "idle" | "running" | "undoable";

const sameText = (left: string, right: string) => left.trimEnd() === right.trimEnd();

/**
 * The draft with the rewrite in place of `replace`, or null once the user has edited it, since
 * their words win over a late rewrite.
 */
export function enhancedDraftText(input: {
  readonly current: string;
  readonly original: string;
  readonly replace: string;
  readonly enhanced: string;
}): string | null {
  if (!sameText(input.current, input.original)) return null;
  if (!input.original.endsWith(input.replace)) return null;
  return input.original.slice(0, input.original.length - input.replace.length) + input.enhanced;
}

/** Running and Undo only hold while the draft is still the text they would replace. */
export function promptEnhancementStatus(
  entry: PromptEnhancementEntry | undefined,
  current: string,
): PromptEnhancementStatus {
  if (entry === undefined) return "idle";
  if (entry.state === "running") return sameText(current, entry.original) ? "running" : "idle";
  return sameText(current, entry.enhanced) ? "undoable" : "idle";
}
