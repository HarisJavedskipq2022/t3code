/**
 * HCode's command terminals: a terminal that runs one command (an app service) as its shell's
 * own process, and a `stop` that waits for that process and its group to exit. Kept out of
 * Manager.ts so upstream changes there merge cleanly.
 */
import { TerminalStopError, type TerminalEvent } from "@t3tools/contracts";
import type * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * Bound on `stop`. Must outlast the SIGTERM->grace->SIGKILL escalation so a
 * stubborn process still gets forced before the wait gives up.
 */
export const DEFAULT_STOP_TIMEOUT_MS = 5_000;
/** How often `stop` checks whether the command's process group has exited. */
const STOP_GROUP_POLL_INTERVAL_MS = 50;

function shellBasename(command: string, platform: NodeJS.Platform): string {
  const normalized =
    platform === "win32" ? command.replaceAll("/", "\\") : command.replaceAll("\\", "/");
  const parts = normalized
    .split(platform === "win32" ? /\\+/ : /\/+/)
    .filter((part) => part.length > 0);
  return parts.at(-1) ?? normalized;
}

/**
 * Shell-specific command-mode arguments for a resolved candidate. The command
 * runs as the shell's own process, so the PTY exit code is the command's. The
 * arguments append to the candidate's interactive ones (e.g. zsh prompt setup).
 */
export function commandArgsForShell(
  candidate: { readonly shell: string; readonly args?: ReadonlyArray<string> },
  command: string,
  platform: NodeJS.Platform,
): string[] {
  const base = candidate.args ?? [];
  if (platform === "win32") {
    const name = shellBasename(candidate.shell, platform).toLowerCase();
    if (name === "pwsh.exe" || name === "powershell.exe") {
      // Native `-Command` semantics: the process exit code is PowerShell's own
      // (a failed native command normalizes to 1). We surface that actual code
      // rather than wrap the command and guess at `$LASTEXITCODE`.
      return [...base, "-Command", command];
    }
    if (name === "cmd.exe" || name === "cmd") {
      return [...base, "/d", "/s", "/c", command];
    }
  }
  // POSIX shells and fish take the command as one `-c` argument; so does any
  // Windows shell without a more specific form.
  return [...base, "-c", command];
}

interface StoppableSession {
  readonly status: string;
  readonly process: PtyAdapter.PtyProcess | null;
  retainedGroupProcess: PtyAdapter.PtyProcess | null;
}

/**
 * Stop whatever process/group a session currently owns, without taking the
 * thread lock (callers already hold it). Waits for the shell exit and, for a
 * group-signaled command terminal, for the owned group to disappear.
 */
export function makeStopLocked<
  Session extends StoppableSession,
  State extends { readonly sessions: ReadonlyMap<string, Session> },
>(deps: {
  readonly getSession: (
    threadId: string,
    terminalId: string,
  ) => Effect.Effect<Option.Option<Session>>;
  readonly startKillEscalation: (
    process: PtyAdapter.PtyProcess,
    threadId: string,
    terminalId: string,
  ) => Effect.Effect<void>;
  readonly subscribe: (
    listener: (event: TerminalEvent) => Effect.Effect<void>,
  ) => Effect.Effect<() => void>;
  readonly modifyManagerState: (
    f: (state: State) => readonly [undefined, State],
  ) => Effect.Effect<undefined>;
  readonly toSessionKey: (threadId: string, terminalId: string) => string;
  readonly stopTimeoutMs: number;
}) {
  const { getSession, startKillEscalation, subscribe, stopTimeoutMs } = deps;
  return Effect.fn("terminal.stopLocked")(function* (input: {
    readonly threadId: string;
    readonly terminalId: string;
  }): Effect.fn.Return<void, TerminalStopError> {
    const sessionOption = yield* getSession(input.threadId, input.terminalId);
    if (Option.isNone(sessionOption)) return;
    const session = sessionOption.value;
    // A running process takes precedence; otherwise a retained group handle left
    // by an earlier stop that timed out (the shell already exited).
    const liveProcess = session.status === "running" ? session.process : null;
    const target = liveProcess ?? session.retainedGroupProcess;
    if (target === null) return;
    // Only a still-running shell emits an exit event; a retained group is
    // signalled and polled directly without waiting for an exit that happened.
    const awaitExit = liveProcess !== null;

    const exited = yield* Deferred.make<void>();
    const waitForTarget = Effect.gen(function* () {
      // Never touch a newer process than the one this stop captured.
      const current = yield* getSession(input.threadId, input.terminalId);
      if (
        Option.isNone(current) ||
        (current.value.process !== target && current.value.retainedGroupProcess !== target)
      ) {
        return;
      }
      yield* startKillEscalation(target, input.threadId, input.terminalId);
      // Only await the exit while this exact shell is still the running process.
      // If it already exited (target is now the retained group), the exit event
      // has fired and must not be waited on again.
      if (current.value.process === target) {
        yield* Deferred.await(exited);
      }
      while (target.isProcessGroupAlive?.() === true) {
        yield* Effect.sleep(Duration.millis(STOP_GROUP_POLL_INTERVAL_MS));
      }
    });

    // acquireUseRelease removes the exit listener on normal return, timeout,
    // interruption or defect, so repeated stops cannot leave it behind.
    const waited = yield* Effect.acquireUseRelease(
      awaitExit
        ? subscribe((event) =>
            event.threadId === input.threadId &&
            event.terminalId === input.terminalId &&
            event.type === "exited"
              ? Deferred.succeed(exited, undefined).pipe(Effect.asVoid)
              : Effect.void,
          )
        : Effect.succeed<() => void>(() => {}),
      () => waitForTarget,
      (unsubscribe) => Effect.sync(unsubscribe),
    ).pipe(Effect.timeoutOption(Duration.millis(stopTimeoutMs)));

    if (Option.isNone(waited)) {
      return yield* new TerminalStopError({
        threadId: input.threadId,
        terminalId: input.terminalId,
        timeoutMs: stopTimeoutMs,
      });
    }
    // Group gone: drop the retained handle for this exact generation.
    yield* deps.modifyManagerState((state) => {
      const live = state.sessions.get(deps.toSessionKey(input.threadId, input.terminalId));
      if (!live || live.retainedGroupProcess !== target) {
        return [undefined, state] as const;
      }
      live.retainedGroupProcess = null;
      return [undefined, state] as const;
    });
  });
}
