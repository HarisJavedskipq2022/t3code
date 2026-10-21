import {
  type OrchestrationV2ProjectedTurnItem,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import * as DateTime from "effect/DateTime";

import {
  describeAgentStep,
  describeSidekickBlocker,
  presentFusionSidekick,
  resolveFusionSidekickActivity,
  runningSidekickCommandMinutes,
} from "./fusionSidekick.ts";

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

describe("describeAgentStep", () => {
  it("names the agent's newest step of its own", () => {
    expect(
      describeAgentStep([
        row({ type: "assistant_message", text: "Looking at the repo" }),
        row({ type: "file_change", fileName: "src/greeting/hello.py" }),
      ]),
    ).toBe("Editing hello.py");
    expect(
      describeAgentStep([row({ type: "command_execution", input: "python3 test_hello.py\n" })]),
    ).toBe("Running python3 test_hello.py");
    expect(describeAgentStep([row({ type: "reasoning" })])).toBe("Thinking");
  });

  it("names an untitled T3 tool call instead of a generic tool", () => {
    expect(
      describeAgentStep([row({ type: "dynamic_tool", toolName: "mcp__t3-code__t3_thread_wait" })]),
    ).toBe("Waiting for a T3 thread");
    expect(describeAgentStep([row({ type: "dynamic_tool", toolName: "mystery_tool" })])).toBe(
      "Using a tool",
    );
  });

  it("skips inherited history and empty messages", () => {
    expect(
      describeAgentStep([
        row({ type: "command_execution", input: "npm test" }),
        row({ type: "file_change", fileName: "lead.ts" }, "inherited"),
        row({ type: "assistant_message", text: "   " }),
      ]),
    ).toBe("Running npm test");
  });

  it("shortens a long message to its first line", () => {
    const step = describeAgentStep([
      row({ type: "assistant_message", text: `${"word ".repeat(30)}\nsecond line` }),
    ]);
    expect(step?.length).toBe(80);
    expect(step?.endsWith("…")).toBe(true);
  });

  it("says nothing before the agent starts on the newest request", () => {
    expect(describeAgentStep([row({ type: "user_message", text: "Add a test" })])).toBeNull();
    expect(describeAgentStep([])).toBeNull();
  });

  it("reads only the given run, so a new send never shows the previous reply", () => {
    const previous = RunId.make("run-1");
    const current = RunId.make("run-2");
    const items = [
      row({ type: "assistant_message", text: "Old reply", runId: previous }),
      row({ type: "command_execution", input: "ls", runId: current }),
    ];
    expect(describeAgentStep(items, current)).toBe("Running ls");
    expect(describeAgentStep(items.slice(0, 1), current)).toBeNull();
  });
});

describe("presentFusionSidekick", () => {
  const activity = (kind: "working" | "approval" | "question" | "finished" | "stopped") => ({
    kind,
    childThreadId: ThreadId.make("thread-sidekick"),
    title: "Add FizzBuzz",
    reason: null,
    role: null,
  });
  const startedAt = DateTime.makeUnsafe("2026-10-13T10:00:00.000Z");
  const running = row({
    type: "command_execution",
    status: "running",
    input: "vp test",
    startedAt,
  });

  it("shows a working sidekick's current step", () => {
    expect(
      presentFusionSidekick({
        activity: activity("working"),
        items: [running],
        nowMs: Date.parse("2026-10-13T10:01:00.000Z"),
      }),
    ).toEqual({
      title: "Sidekick is working",
      warning: false,
      description: "Running vp test · 1m",
      stalled: false,
      openLabel: "Open sidekick",
    });
  });

  it("names a role sidekick by its role", () => {
    expect(
      presentFusionSidekick({
        activity: { ...activity("approval"), role: "ui" },
        items: [],
        nowMs: 0,
      }).title,
    ).toBe("ui sidekick needs approval");
  });

  it("warns once the sidekick's command has run past the stall threshold", () => {
    expect(
      presentFusionSidekick({
        activity: activity("working"),
        items: [running],
        nowMs: Date.parse("2026-10-13T10:03:00.000Z"),
      }),
    ).toMatchObject({ title: "Sidekick may be stuck", warning: true, stalled: true });
  });

  it("says what a blocked sidekick waits on and offers to open it", () => {
    expect(
      presentFusionSidekick({
        activity: activity("approval"),
        items: [row({ type: "approval_request", requestKind: "command", prompt: "git push" })],
        nowMs: 0,
      }),
    ).toMatchObject({
      title: "Sidekick needs approval",
      warning: true,
      description: "Needs approval to run a command: git push",
      openLabel: "Open approval",
    });
  });

  it("falls back to the sidekick's title, and prefers a stop reason", () => {
    expect(
      presentFusionSidekick({ activity: activity("finished"), items: [], nowMs: 0 }),
    ).toMatchObject({ description: "Add FizzBuzz", warning: false });
    expect(
      presentFusionSidekick({
        activity: { ...activity("stopped"), reason: "Usage limit reached" },
        items: [],
        nowMs: 0,
      }),
    ).toMatchObject({
      title: "Sidekick stopped",
      description: "Usage limit reached",
      warning: true,
    });
  });
});
