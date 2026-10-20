import { CircleAlertIcon, ShieldXIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "~/lib/utils";

const CLAMP_LINES = 6;
const CLAMP_CHARS = 480;

const boxClassName = "rounded-md border border-border/45 bg-muted/15 p-2";

/** A hook or tool error a provider returned in place of output, split into a title and message. */
export function parseToolError(
  output: string,
): { hook: boolean; title: string; message: string } | null {
  const text = output.trim();
  const hook = /^(?:Error:\s*)?(\w+)(?::\S+)? hook error:\s*/.exec(text);
  if (hook) {
    return {
      hook: true,
      title: `${hook[1]} hook blocked this call`,
      message: text.slice(hook[0].length),
    };
  }
  const error = /^Error:\s*/.exec(text);
  return error ? { hook: false, title: "Error", message: text.slice(error[0].length) } : null;
}

function ArgValue({ value }: { readonly value: string }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = value.split("\n").length;
  const long = lineCount > CLAMP_LINES || value.length > CLAMP_CHARS;
  return (
    <div className="min-w-0">
      <div className={cn("text-foreground/85", long && !expanded && "line-clamp-6")}>{value}</div>
      {long ? (
        <button
          type="button"
          className="mt-0.5 text-primary hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : lineCount > 1 ? `Show all ${lineCount} lines` : "Show all"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A tool call's input as labelled fields. `renderValue` overrides one field's look
 * (code, say); `raw` is the original input when the fields were rewritten for reading.
 */
export function ToolCallArgs(props: {
  readonly lines: ReadonlyArray<readonly [string, string]>;
  readonly renderValue?: (key: string, value: string) => ReactNode | undefined;
  readonly raw?: unknown;
}) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="space-y-1">
      <div className={cn(boxClassName, "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1")}>
        {props.lines.map(([key, value]) => (
          <div key={key} className="contents">
            <span className="text-muted-foreground">{key}</span>
            {props.renderValue?.(key, value) ?? <ArgValue value={value} />}
          </div>
        ))}
      </div>
      {props.raw === undefined ? null : (
        <>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            aria-expanded={showRaw}
            onClick={() => setShowRaw(!showRaw)}
          >
            {showRaw ? "Hide raw input" : "Show raw input"}
          </button>
          {showRaw ? (
            <pre className={cn(boxClassName, "max-h-80 overflow-auto text-muted-foreground")}>
              {JSON.stringify(props.raw, null, 2)}
            </pre>
          ) : null}
        </>
      )}
    </div>
  );
}

export function ToolCallError(props: {
  readonly error: NonNullable<ReturnType<typeof parseToolError>>;
}) {
  const Icon = props.error.hook ? ShieldXIcon : CircleAlertIcon;
  return (
    <div className="flex gap-2 rounded-md border border-destructive/36 bg-destructive/5 p-2 text-destructive">
      <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{props.error.title}</div>
        {props.error.message ? (
          <div className="max-h-60 overflow-auto">{props.error.message}</div>
        ) : null}
      </div>
    </div>
  );
}
