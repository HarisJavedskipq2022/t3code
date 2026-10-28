import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import type { DraftId } from "~/composerDraftStore";
import type { DiffPanelSelection } from "~/diffPanelStore";

import type { AnnotatableCodeViewHandle } from "../diffs/AnnotatableCodeView";
import type { useCodeViewFileReveal } from "../diffs/useCodeViewFileReveal";
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

/**
 * The panel skips its own file scroll for a line reveal, so this one scrolls to the line.
 * Returns the viewer ref, which also attaches the panel's file reveal.
 */
export function useVetLineScroll(
  fileReveal: ReturnType<typeof useCodeViewFileReveal>,
  codeViewMountKey: string,
  fileKey: string | null,
  reveal: { readonly requestId: number; readonly line: number | null },
) {
  const [codeView, setCodeView] = useState<AnnotatableCodeViewHandle | null>(null);
  const [attach] = useState(() => (next: AnnotatableCodeViewHandle | null) => {
    fileReveal.attach(next);
    setCodeView(next);
  });
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
  return attach;
}
