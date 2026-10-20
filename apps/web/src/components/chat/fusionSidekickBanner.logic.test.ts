import {
  type OrchestrationV2ProjectedTurnItem,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import * as DateTime from "effect/DateTime";

import {
  describeSidekickBlocker,
  leadIsWaitingOnSidekick,
  resolveFusionSidekickActivity,
  runningSidekickCommandMinutes,
} from "./fusionSidekickBanner.logic";

const sidekick = { childThreadId: ThreadId.make("thread-sidekick"), status: "idle" } as const;
const leadActivityStartedAt = "2026-10-13T10:00:00.000Z";

function child(
  status: "running" | "completed" | "failed" | "idle",
  updatedAt = "2026-10-13T10:05:00.000Z",
) {
  return {
    title: "Add FizzBuzz",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    runtime: {
      status,
      activeRunId: status === "running" ? RunId.make("run-sidekick") : null,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: null,
      lastError: status === "failed" ? "Usage limit reached" : null,
      updatedAt,
    },
  };
}

describe("resolveFusionSidekickActivity", () => {
  it("shows a working sidekick whether or not the lead is busy", () => {
    for (const leadWorking of [true, false]) {
      expect(
        resolveFusionSidekickActivity({
          sidekick,
          child: child("running"),
          leadWorking,
          leadActivityStartedAt: leadWorking ? leadActivityStartedAt : null,
        }),
      ).toMatchObject({ kind: "working", childThreadId: "thread-sidekick", title: "Add FizzBuzz" });
    }
  });

  it("says the lead is reviewing once the sidekick settles during the lead's turn", () => {
    expect(
      resolveFusionSidekickActivity({
        sidekick,
        child: child("completed"),
        leadWorking: true,
        leadActivityStartedAt,
      }),
    ).toMatchObject({ kind: "finished" });
  });

  it("reports a sidekick that failed during the lead's turn, with the reason", () => {
    expect(
      resolveFusionSidekickActivity({
        sidekick: { ...sidekick, status: "failed" },
        child: child("failed"),
        leadWorking: true,
        leadActivityStartedAt,
      }),
    ).toMatchObject({ kind: "stopped", reason: "Usage limit reached" });
  });

  it("stays hidden for settled work the lead is not reviewing", () => {
    // The lead finished too.
    expect(
      resolveFusionSidekickActivity({
        sidekick,
        child: child("completed"),
        leadWorking: false,
        leadActivityStartedAt: null,
      }),
    ).toBeNull();
    // The sidekick settled before this lead turn began.
    expect(
      resolveFusionSidekickActivity({
        sidekick,
        child: child("completed", "2026-10-13T09:00:00.000Z"),
        leadWorking: true,
        leadActivityStartedAt,
      }),
    ).toBeNull();
  });

  it("says what a blocked sidekick waits on, even while the lead is idle", () => {
    expect(
      resolveFusionSidekickActivity({
        sidekick,
        child: { ...child("running"), hasPendingApprovals: true },
        leadWorking: false,
        leadActivityStartedAt: null,
      }),
    ).toMatchObject({ kind: "approval", childThreadId: "thread-sidekick" });
    expect(
      resolveFusionSidekickActivity({
        sidekick,
        child: { ...child("running"), hasPendingUserInput: true },
        leadWorking: true,
        leadActivityStartedAt,
      }),
    ).toMatchObject({ kind: "question" });
  });

  it("ignores a request a finished sidekick run left behind", () => {
    expect(
      resolveFusionSidekickActivity({
        sidekick,
        child: { ...child("completed", "2026-10-13T09:00:00.000Z"), hasPendingUserInput: true },
        leadWorking: true,
        leadActivityStartedAt,
      }),
    ).toBeNull();
  });

  it("leaves missing threads to other surfaces", () => {
    expect(
      resolveFusionSidekickActivity({
        sidekick: null,
        child: child("running"),
        leadWorking: true,
        leadActivityStartedAt,
      }),
    ).toBeNull();
    expect(
      resolveFusionSidekickActivity({
        sidekick,
        child: null,
        leadWorking: true,
        leadActivityStartedAt,
      }),
    ).toBeNull();
  });
});

type Row = Pick<OrchestrationV2ProjectedTurnItem, "visibility" | "item">;
// Only the fields the describer reads; the rest of a turn item is irrelevant here.
const row = (item: Record<string, unknown>, visibility: Row["visibility"] = "local"): Row =>
  ({ visibility, item }) as unknown as Row;

describe("runningSidekickCommandMinutes", () => {
  const startedAt = DateTime.makeUnsafe("2026-10-13T10:00:00.000Z");
  const now = Date.parse("2026-10-13T10:04:30.000Z");

  it("counts whole minutes for the sidekick's newest command while it runs", () => {
    expect(
      runningSidekickCommandMinutes(
        [row({ type: "command_execution", status: "running", input: "vp test run", startedAt })],
        now,
      ),
    ).toBe(4);
  });

  it("is null once the newest step is anything but a running command", () => {
    const finished = row({ type: "command_execution", status: "completed", startedAt });
    const thinking = row({ type: "reasoning", status: "running", startedAt });
    expect(runningSidekickCommandMinutes([finished], now)).toBeNull();
    expect(
      runningSidekickCommandMinutes(
        [row({ type: "command_execution", status: "running", startedAt }), thinking],
        now,
      ),
    ).toBeNull();
    expect(
      runningSidekickCommandMinutes(
        [row({ type: "command_execution", status: "running", startedAt }, "inherited")],
        now,
      ),
    ).toBeNull();
  });
});

describe("describeSidekickBlocker", () => {
  it("names the approval the sidekick needs and what it wants to run", () => {
    expect(
      describeSidekickBlocker(
        [
          row({ type: "approval_request", requestKind: "file-change", prompt: "Edit a.ts" }),
          row({ type: "command_execution", status: "running", input: "ls" }),
          row({
            type: "approval_request",
            requestKind: "command",
            prompt: "git push origin main\n--force",
          }),
        ],
        "approval",
      ),
    ).toBe("Needs approval to run a command: git push origin main");
    expect(
      describeSidekickBlocker(
        [row({ type: "approval_request", requestKind: "mcp-elicitation", appName: "Figma" })],
        "approval",
      ),
    ).toBe("Needs approval for a tool: Figma");
    expect(
      describeSidekickBlocker(
        [row({ type: "approval_request", requestKind: "permission" })],
        "approval",
      ),
    ).toBe("Needs a permission");
  });

  it("quotes the sidekick's unanswered question", () => {
    const question = (text: string, questionAnswer?: unknown) =>
      row({
        type: "user_input_request",
        questions: [{ id: "q", header: "Choice", question: text, options: [] }],
        ...(questionAnswer === undefined ? {} : { questionAnswer }),
      });
    expect(
      describeSidekickBlocker(
        [question("Which database?"), question("Keep the old API?", { answers: {} })],
        "question",
      ),
    ).toBe("Which database?");
    expect(
      describeSidekickBlocker([question("Which database?", { answers: {} })], "question"),
    ).toBeNull();
  });
});

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
