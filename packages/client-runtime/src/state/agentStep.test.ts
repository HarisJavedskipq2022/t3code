import { type OrchestrationV2ProjectedTurnItem, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { describeAgentStep } from "./agentStep.ts";

type Row = Pick<OrchestrationV2ProjectedTurnItem, "visibility" | "item">;

const row = (item: Record<string, unknown>, visibility: Row["visibility"] = "local"): Row =>
  ({ visibility, item }) as unknown as Row;

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
