import { FileDiff } from "@pierre/diffs/react";

import { useRenderedAppearance } from "../../hooks/useTheme";
import {
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../../lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "../../lib/syntaxHighlighting";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { inlineFilePatch } from "./forkCodeChunks.logic";

/** A file edit's changed lines and their context, inline in the timeline. */
export function ForkInlineFileDiff(props: {
  readonly fileName: string;
  readonly diffStr: string | undefined;
  readonly cacheKey: string;
}) {
  const appearance = useRenderedAppearance();
  const patch = inlineFilePatch(props.fileName, props.diffStr);
  const renderable = patch === null ? null : getRenderablePatch(patch, props.cacheKey);
  if (renderable?.kind !== "files") return null;
  return (
    <div className="overflow-hidden rounded-md border border-border/45">
      <DiffWorkerPoolProvider>
        {renderable.files.map((fileDiff) => (
          <FileDiff
            key={resolveFileDiffPath(fileDiff)}
            fileDiff={fileDiff}
            options={{
              collapsed: false,
              diffStyle: "unified",
              disableFileHeader: true,
              theme: resolveDiffThemeName(appearance),
              preferredHighlighter: PREFERRED_HIGHLIGHTER,
            }}
          />
        ))}
      </DiffWorkerPoolProvider>
    </div>
  );
}
