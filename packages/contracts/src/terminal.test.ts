import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_TERMINAL_ID,
  TerminalError,
  TerminalOpenInput,
  TerminalProviderEnvironmentError,
  TerminalRestartInput,
  TerminalStopError,
} from "./terminal.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

function decodes<S extends Schema.Top>(schema: S, input: unknown): boolean {
  try {
    Schema.decodeUnknownSync(schema as never)(input);
    return true;
  } catch {
    return false;
  }
}

const encodeTerminalError = Schema.encodeUnknownSync(TerminalError);
const decodeTerminalError = Schema.decodeUnknownSync(TerminalError);

function decodeSync<S extends Schema.Top>(schema: S, input: unknown): Schema.Schema.Type<S> {
  return Schema.decodeUnknownSync(schema as never)(input) as Schema.Schema.Type<S>;
}

describe("TerminalProviderEnvironmentError", () => {
  it("round-trips its required cause without exposing it in the message", () => {
    const cause = { operation: "read-secret", detail: "secret backend unavailable" };
    const error = new TerminalProviderEnvironmentError({
      providerInstanceId: ProviderInstanceId.make("codex_work"),
      cause,
    });
    const encoded = encodeTerminalError(error);
    const decoded = decodeTerminalError(encoded);

    expect(decoded).toMatchObject({
      _tag: "TerminalProviderEnvironmentError",
      providerInstanceId: "codex_work",
      cause,
    });
    expect(decoded.message).toBe(
      "Could not prepare the terminal environment for provider instance: codex_work",
    );
    expect(decoded.message).not.toContain("secret backend unavailable");
  });
});

describe("TerminalStopError", () => {
  it("round-trips its timeout context without exposing anything else", () => {
    const error = new TerminalStopError({
      threadId: "thread-1",
      terminalId: DEFAULT_TERMINAL_ID,
      timeoutMs: 5_000,
    });
    const decoded = decodeTerminalError(encodeTerminalError(error));

    expect(decoded).toMatchObject({
      _tag: "TerminalStopError",
      threadId: "thread-1",
      terminalId: DEFAULT_TERMINAL_ID,
      timeoutMs: 5_000,
    });
    expect(decoded.message).toContain("5000ms");
  });
});

describe("TerminalOpenInput", () => {
  it("drops invalid env keys while retaining valid overrides", () => {
    const parsed = decodeSync(TerminalOpenInput, {
      threadId: "thread-1",
      terminalId: DEFAULT_TERMINAL_ID,
      cwd: "/tmp/project",
      env: { "bad-key": "1", GOOD_KEY: "2" },
    });
    expect(parsed.env).toEqual({ GOOD_KEY: "2" });
  });

  it("accepts a bounded command and trims it", () => {
    const parsed = decodeSync(TerminalOpenInput, {
      threadId: "thread-1",
      terminalId: DEFAULT_TERMINAL_ID,
      cwd: "/tmp/project",
      command: "  npm run dev  ",
    });
    expect(parsed.command).toBe("npm run dev");
  });

  it("rejects an empty or oversized command", () => {
    for (const command of ["", "   ", "a".repeat(65_537)]) {
      expect(
        decodes(TerminalOpenInput, {
          threadId: "thread-1",
          terminalId: DEFAULT_TERMINAL_ID,
          cwd: "/tmp/project",
          command,
        }),
      ).toBe(false);
    }
  });
});

describe("TerminalAttachInput", () => {
  it("accepts a bounded command for a command-mode restart", () => {
    const parsed = decodeSync(TerminalRestartInput, {
      threadId: "thread-1",
      terminalId: DEFAULT_TERMINAL_ID,
      cwd: "/tmp/project",
      cols: 100,
      rows: 24,
      command: "npm run dev",
    });
    expect(parsed.command).toBe("npm run dev");
  });
});
