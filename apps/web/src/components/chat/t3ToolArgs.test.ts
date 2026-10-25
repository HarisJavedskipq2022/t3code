import { describe, expect, it } from "vite-plus/test";

import { readableT3ToolArgs, t3ToolArgsThreadId } from "./t3ToolArgs";

const wait = "mcp__t3-code__t3_thread_wait";
const encodedId = "thread:delegated-task:command%3Amcp%3Ab96%3Adelegate-task%3Asidekick";

describe("readableT3ToolArgs", () => {
  it("names the thread, shows the timeout in minutes, and drops the request key", () => {
    expect(
      readableT3ToolArgs(
        wait,
        { threadId: encodedId, timeoutMs: 3_600_000, clientRequestId: "step-3" },
        "Ticket worker: SHP-3783",
      ),
    ).toEqual({ thread: "Ticket worker: SHP-3783", timeout: "60 min" });
    expect(readableT3ToolArgs(wait, { timeoutMs: 45_000 }, null)).toEqual({ timeout: "45 s" });
  });

  it("keeps the raw thread id while its title is unknown", () => {
    expect(readableT3ToolArgs(wait, { threadId: encodedId }, null)).toEqual({
      threadId: encodedId,
    });
  });

  it("leaves other tools' input untouched", () => {
    const input = { threadId: "x", timeoutMs: 1000 };
    expect(readableT3ToolArgs("Bash", input, "Title")).toBe(input);
    expect(t3ToolArgsThreadId("Bash", input)).toBeNull();
    expect(t3ToolArgsThreadId(wait, { threadId: ` ${encodedId} ` })).toBe(encodedId);
  });
});
