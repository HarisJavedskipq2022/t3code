import { type ReactNode, useState } from "react";

// Short snippets read fine without a gutter.
const LINE_NUMBERS_FROM = 4;
// Longer blocks show their first lines (see forkCodeChunks.css) until expanded.
const CLAMP_FROM = 30;

const toggleClassName =
  "rounded-sm px-3 pb-2 text-2xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * A markdown code block's body with a line-number gutter and, once finished
 * streaming, long blocks clipped behind "Show all N lines".
 */
export function ForkCodeLines(props: {
  readonly code: string;
  readonly isStreaming: boolean;
  readonly children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = props.code.replace(/\n$/u, "").split("\n").length;
  const clamped = !props.isStreaming && !expanded && lineCount >= CLAMP_FROM;
  return (
    <div
      data-fork-line-numbers={lineCount >= LINE_NUMBERS_FROM ? "" : undefined}
      data-fork-clamped={clamped ? "" : undefined}
    >
      {props.children}
      {!props.isStreaming && lineCount >= CLAMP_FROM ? (
        <button type="button" className={toggleClassName} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : `Show all ${lineCount} lines`}
        </button>
      ) : null}
    </div>
  );
}
