import { DesktopForkSyncResultSchema, type DesktopForkSyncResult } from "@t3tools/contracts";
import * as Electron from "electron";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopConfig from "../../app/DesktopConfig.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

// One sync at a time: a second click, or a reloaded window, joins the run in flight.
let inFlight: Deferred.Deferred<DesktopForkSyncResult> | null = null;

/**
 * Runs a fork build's scripts/fork-sync.sh and reports how it ended. The
 * script logs to ~/.t3code-fork/sync.log and posts its own notifications.
 * Quitting the app stops it, which leaves the `fork` branch untouched.
 */
export const runForkSyncScript = Effect.fn("desktop.forkSync.runScript")(function* (
  script: string,
) {
  if (inFlight !== null) return yield* Deferred.await(inFlight);
  const done = yield* Deferred.make<DesktopForkSyncResult>();
  inFlight = done;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make("/bin/bash", [script], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
      );
      const exitCode = Number(yield* handle.exitCode);
      return exitCode === 0 ? ("built" as const) : ("failed" as const);
    }),
  ).pipe(
    Effect.orElseSucceed(() => "failed" as const),
    Effect.onExit((exit) => {
      inFlight = null;
      return Deferred.done(done, Exit.isSuccess(exit) ? exit : Exit.succeed("failed"));
    }),
  );
});

export const runForkSync = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FORK_SYNC_RUN_CHANNEL,
  payload: Schema.Void,
  result: DesktopForkSyncResultSchema,
  handler: Effect.fn("desktop.ipc.forkSync.run")(function* () {
    const { forkSyncScript } = yield* DesktopConfig.DesktopConfig;
    if (Option.isNone(forkSyncScript)) return "unavailable" as const;
    return yield* runForkSyncScript(forkSyncScript.value);
  }),
});

/** Quits so fork-sync's waiting installer swaps in the new build and reopens it. */
export const quitToInstallForkSync = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FORK_SYNC_QUIT_TO_INSTALL_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: () => Effect.sync(() => Electron.app.quit()),
});
