import { type OrchestrationV2ProjectedTurnItem, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { leadIsWaitingOnSidekick } from "./fusionSidekickBanner.logic";

describe("leadIsWaitingOnSidekick", () => {
  const runId = RunId.make("run-lead");
  const sidekickThreadId = ThreadId.make("thread-sidekick");
  type Row = Pick<OrchestrationV2ProjectedTurnItem, "visibility" | "item">;
  const tool = (toolName: string, threadId: string, status = "running", run = runId): Row =>
    ({
      visibility: "local",
      item: { type: "dynamic_tool", runId: run, status, toolName, input: { threadId } },
    }) as unknown as Row;
  const wait = "mcp__t3-code__t3_thread_wait";

  it("is true while the lead's newest step is a running wait on its sidekick", () => {
    expect(
      leadIsWaitingOnSidekick(
        [
          tool("mcp__t3-code__t3_thread_send", sidekickThreadId, "completed"),
          tool(wait, sidekickThreadId),
        ],
        sidekickThreadId,
        runId,
      ),
    ).toBe(true);
  });

  it("is false for a finished wait, another thread, another tool, or an earlier run", () => {
    const check = (row: Row) => leadIsWaitingOnSidekick([row], sidekickThreadId, runId);
    expect(check(tool(wait, sidekickThreadId, "completed"))).toBe(false);
    expect(check(tool(wait, "thread-other"))).toBe(false);
    expect(check(tool("mcp__t3-code__t3_thread_read", sidekickThreadId))).toBe(false);
    expect(check(tool(wait, sidekickThreadId, "running", RunId.make("run-old")))).toBe(false);
    expect(leadIsWaitingOnSidekick([], sidekickThreadId, runId)).toBe(false);
  });
});
