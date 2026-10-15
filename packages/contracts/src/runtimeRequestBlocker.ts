import type { OrchestrationV2RuntimeRequest } from "./orchestrationV2.ts";

type RuntimeRequestKind = OrchestrationV2RuntimeRequest["kind"];

/**
 * What a pending runtime request is waiting on. A question can be answered by
 * an agent or a person; an approval only by a person. Tool calls and auth
 * refreshes are answered by the app and block nobody, so they are null.
 */
export function runtimeRequestBlocker(kind: RuntimeRequestKind): "question" | "approval" | null {
  if (kind === "user_input") return "question";
  if (kind === "dynamic_tool_call" || kind === "auth_refresh") return null;
  return "approval";
}

/** What a blocked task needs, phrased to follow "needs", e.g. "approval to run a command". */
export function runtimeRequestNeed(kind: RuntimeRequestKind): string {
  switch (kind) {
    case "user_input":
      return "an answer to a question";
    case "command":
      return "approval to run a command";
    case "file-read":
      return "approval to read files";
    case "file-change":
      return "approval to change files";
    case "mcp-elicitation":
      return "approval for a tool";
    case "permission":
      return "a permission";
    case "dynamic_tool_call":
    case "auth_refresh":
      return "the app";
  }
}
