import {
  type OrchestrationV2ProjectedTurnItem,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { describeSidekickStep, resolveFusionSidekickActivity } from "./fusionSidekickBanner.logic";

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

  it("leaves input requests and missing threads to other surfaces", () => {
    expect(
      resolveFusionSidekickActivity({
        sidekick,
        child: { ...child("running"), hasPendingUserInput: true },
        leadWorking: true,
        leadActivityStartedAt,
      }),
    ).toBeNull();
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

describe("describeSidekickStep", () => {
  it("names the sidekick's newest step of its own", () => {
    expect(
      describeSidekickStep([
        row({ type: "assistant_message", text: "Looking at the repo" }),
        row({ type: "file_change", fileName: "src/greeting/hello.py" }),
      ]),
    ).toBe("Editing hello.py");
    expect(
      describeSidekickStep([row({ type: "command_execution", input: "python3 test_hello.py\n" })]),
    ).toBe("Running python3 test_hello.py");
    expect(describeSidekickStep([row({ type: "reasoning" })])).toBe("Thinking");
  });

  it("skips the lead's inherited history and empty messages", () => {
    expect(
      describeSidekickStep([
        row({ type: "command_execution", input: "npm test" }),
        row({ type: "file_change", fileName: "lead.ts" }, "inherited"),
        row({ type: "assistant_message", text: "   " }),
      ]),
    ).toBe("Running npm test");
  });

  it("shortens a long message to its first line", () => {
    const step = describeSidekickStep([
      row({ type: "assistant_message", text: `${"word ".repeat(30)}\nsecond line` }),
    ]);
    expect(step?.length).toBe(80);
    expect(step?.endsWith("…")).toBe(true);
  });

  it("says nothing before the sidekick starts on the newest request", () => {
    expect(describeSidekickStep([row({ type: "user_message", text: "Add a test" })])).toBeNull();
    expect(describeSidekickStep([])).toBeNull();
  });
});
