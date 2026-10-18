import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import type { DraftId } from "~/composerDraftStore";
import type { DiffPanelSelection } from "~/diffPanelStore";

import type { AnnotatableCodeViewHandle } from "../diffs/AnnotatableCodeView";
import { useVetLineNotes } from "./VetPanel";

/** The branch-diff file and line a Vet finding asked to show, and the findings to pin. */
export function useVetDiffReveal(
  diffSelection: DiffPanelSelection,
  threadRef: ScopedThreadRef | null,
  composerDraftTarget: ScopedThreadRef | DraftId,
) {
  const reveal = diffSelection.kind === "branch" ? diffSelection.reveal : undefined;
  // Findings cite lines of the current files, which a past turn's diff does not show.
  const lineNotes = useVetLineNotes(
    diffSelection.kind === "turn" ? null : threadRef,
    composerDraftTarget,
  );
  return {
    filePath: reveal?.filePath ?? null,
    requestId: reveal?.requestId ?? 0,
    line: reveal?.line ?? null,
    lineNotes,
  };
}

/** Called after the panel's own file scroll so the line scroll lands last. */
export function useVetLineScroll(
  codeView: AnnotatableCodeViewHandle | null,
  codeViewMountKey: string,
  fileKey: string | null,
  reveal: { readonly requestId: number; readonly line: number | null },
) {
  const { requestId, line } = reveal;
  useEffect(() => {
    if (line === null || !fileKey || !codeView?.getInstance()) return;
    codeView.scrollTo({ type: "item", id: fileKey, align: "start" });
    // A line hidden in collapsed context cannot be resolved; the file stays in view instead.
    codeView.scrollTo({
      type: "line",
      id: fileKey,
      lineNumber: line,
      side: "additions",
      align: "center",
    });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A remounted viewer or a repeated reveal request scrolls to the same line again.
  }, [codeView, codeViewMountKey, fileKey, requestId, line]);
}
