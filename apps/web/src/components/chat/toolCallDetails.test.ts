import { describe, expect, it } from "vite-plus/test";

import { parseToolError } from "./toolCallDetails";

describe("parseToolError", () => {
  it("names the hook that blocked a call and keeps its message", () => {
    expect(
      parseToolError(
        "Error: PreToolUse:mcp__t3-code__delegate_task hook error: Briefs must carry the rule.",
      ),
    ).toEqual({
      hook: true,
      title: "PreToolUse hook blocked this call",
      message: "Briefs must carry the rule.",
    });
    expect(parseToolError("PreToolUse:Bash hook error: Code search is gated.")?.title).toBe(
      "PreToolUse hook blocked this call",
    );
  });

  it("splits a plain error envelope and ignores ordinary output", () => {
    expect(parseToolError("  Error: thread not found\n")).toEqual({
      hook: false,
      title: "Error",
      message: "thread not found",
    });
    expect(parseToolError("FAILED test_fizzbuzz.py::test_fizz")).toBeNull();
  });
});
