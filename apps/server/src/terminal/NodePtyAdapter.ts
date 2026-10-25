import * as NodeModule from "node:module";
import * as NodeNet from "node:net";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as PtyAdapter from "@t3tools/shared/PtyAdapter";

export class NodePtyModuleLoadError extends Schema.TaggedError<NodePtyModuleLoadError>()(
  "NodePtyModuleLoadError",
  {
    platform: Schema.String,
    architecture: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to load node-pty for ${this.platform}-${this.architecture}.`;
  }
}

type NodePtyModuleLoader = () => Promise<typeof import("node-pty")>;

// node-pty's native addon stays external; single-executables need require to resolve disk modules and spawn helpers.
const requireForNodePty = NodeModule.createRequire(import.meta.url);

const loadNodePty: NodePtyModuleLoader = () =>
  Promise.resolve().then(() => requireForNodePty("node-pty") as typeof import("node-pty"));

export const NodePtyModuleLoaderRef = Context.Reference<NodePtyModuleLoader>(
  "server/terminal/NodePtyModuleLoader",
  { defaultValue: () => loadNodePty },
);

/** Whether a thrown error carries a POSIX errno code. */
const isErrnoCode = (error: unknown, code: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { readonly code?: unknown }).code === code;

let didEnsureSpawnHelperExecutable = false;

const resolveNodePtySpawnHelperPath = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const architecture = yield* HostProcess.Architecture;

  const packageJsonPath = requireForNodePty.resolve("node-pty/package.json");
  const packageDir = path.dirname(packageJsonPath);
  const candidates = [
    path.join(packageDir, "build", "Release", "spawn-helper"),
    path.join(packageDir, "build", "Debug", "spawn-helper"),
    path.join(packageDir, "prebuilds", `${platform}-${architecture}`, "spawn-helper"),
  ];

  for (const candidate of candidates) {
    if (yield* fs.exists(candidate)) {
      return candidate;
    }
  }
  return null;
}).pipe(Effect.orElseSucceed(() => null));

const ensureNodePtySpawnHelperExecutable = Effect.fn(function* () {
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  if (platform === "win32") return;
  if (didEnsureSpawnHelperExecutable) return;

  const helperPath = yield* resolveNodePtySpawnHelperPath;
  if (!helperPath) return;
  didEnsureSpawnHelperExecutable = true;

  if (!(yield* fs.exists(helperPath))) {
    return;
  }

  yield* fs.chmod(helperPath, 0o755).pipe(Effect.orElseSucceed(() => undefined));
});

// node-pty has no public readiness event; ready_datapipe sets pid before our listener.
// Deferred pipe creation: https://github.com/microsoft/node-pty/pull/885
const waitForWindowsPid = (
  process: import("node-pty").IPty,
  trackedProcess: NodePtyProcess,
  shell: string,
) =>
  Effect.callback<void, PtyAdapter.PtySpawnError>((resume) => {
    const hasPid = () => Number.isInteger(process.pid) && process.pid > 0;
    const failure = (cause: unknown) =>
      Effect.fail(new PtyAdapter.PtySpawnError({ adapter: "node-pty", shell, cause }));

    if (hasPid()) {
      resume(Effect.void);
      return;
    }

    if (!("_socket" in process) || !(process._socket instanceof NodeNet.Socket)) {
      resume(failure(new Error("Windows PTY readiness socket is unavailable.")));
      return;
    }

    const socket = process._socket;
    const onReady = () => {
      cleanup();
      resume(
        hasPid()
          ? Effect.void
          : failure(new Error("Windows PTY became ready without a valid PID.")),
      );
    };
    const onError = (cause: Error) => {
      cleanup();
      resume(failure(cause));
    };
    const onClose = () => onError(new Error("Windows PTY closed before its PID was available."));
    let stopExit = () => {};
    const cleanup = () => {
      socket.off("ready_datapipe", onReady);
      socket.off("error", onError);
      socket.off("close", onClose);
      stopExit();
    };
    socket.once("ready_datapipe", onReady);
    socket.once("error", onError);
    socket.once("close", onClose);
    stopExit = trackedProcess.onExit(({ exitCode }) =>
      onError(
        new Error(`Windows PTY exited before its PID was available (exit code ${exitCode}).`),
      ),
    );
    return Effect.sync(cleanup);
  });

// The private agent cancels pending connections before a child exists; public kill waits for first output.
const killStartingWindowsPty = (process: import("node-pty").IPty) =>
  Effect.try(() => {
    if (
      "_agent" in process &&
      typeof process._agent === "object" &&
      process._agent !== null &&
      "kill" in process._agent &&
      typeof process._agent.kill === "function"
    ) {
      process._agent.kill();
    } else {
      process.kill();
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("failed to cancel Windows terminal startup", {
        terminalPid: process.pid,
        cause: error,
      }),
    ),
  );

class NodePtyProcess implements PtyAdapter.PtyProcess {
  private readonly process: import("node-pty").IPty;
  private readonly platform: NodeJS.Platform;
  private readonly signalProcessGroup: boolean;
  private exitEvent: PtyAdapter.PtyExitEvent | undefined;
  private readonly exitListeners = new Set<(event: PtyAdapter.PtyExitEvent) => void>();
  private readonly exitSubscription: import("node-pty").IDisposable;

  constructor(
    process: import("node-pty").IPty,
    platform: NodeJS.Platform,
    signalProcessGroup: boolean,
  ) {
    this.process = process;
    this.platform = platform;
    this.signalProcessGroup = signalProcessGroup;
    this.exitSubscription = process.onExit((event) => {
      if (this.exitEvent) return;
      this.exitEvent = { exitCode: event.exitCode, signal: event.signal ?? null };
      this.exitSubscription.dispose();
      for (const listener of this.exitListeners) listener(this.exitEvent);
      this.exitListeners.clear();
    });
  }

  get pid(): number {
    return this.process.pid;
  }

  write(data: string): void {
    this.process.write(data);
  }

  resize(cols: number, rows: number): void {
    this.process.resize(cols, rows);
  }

  kill(signal?: string): void {
    // node-pty terminates the Windows process tree without a POSIX signal.
    if (this.platform === "win32") {
      this.process.kill(undefined);
      return;
    }
    // forkpty makes the child a session leader, so its PID is also the group
    // id and the captured PID addresses the whole owned group. Only an
    // explicit signal uses this path; an untyped kill keeps node-pty's own
    // semantics. ESRCH means the group is already gone; any other failure is
    // real and must not silently degrade to a single-PID kill.
    if (this.signalProcessGroup && signal !== undefined && this.validGroupPid()) {
      try {
        process.kill(-this.pid, signal as NodeJS.Signals);
        return;
      } catch (error) {
        if (!isErrnoCode(error, "ESRCH")) throw error;
        return;
      }
    }
    this.process.kill(signal);
  }

  /**
   * Whether the owned process group still has members. Signal 0 neither
   * delivers a signal nor creates one; EPERM still means the group exists.
   */
  isProcessGroupAlive(): boolean {
    if (this.platform === "win32" || !this.signalProcessGroup || !this.validGroupPid()) {
      return false;
    }
    try {
      process.kill(-this.pid, 0);
      return true;
    } catch (error) {
      return !isErrnoCode(error, "ESRCH");
    }
  }

  private validGroupPid(): boolean {
    return Number.isInteger(this.pid) && this.pid > 0;
  }

  onData(callback: (data: string) => void): () => void {
    const disposable = this.process.onData(callback);
    return () => {
      disposable.dispose();
    };
  }

  onExit(callback: (event: PtyAdapter.PtyExitEvent) => void): () => void {
    if (this.exitEvent) {
      callback(this.exitEvent);
      return () => {};
    }
    this.exitListeners.add(callback);
    return () => {
      this.exitListeners.delete(callback);
    };
  }

  disposeExitSubscription(): void {
    this.exitSubscription.dispose();
    this.exitListeners.clear();
  }
}

const make = Effect.fn("NodePtyAdapter.make")(function* () {
  const loadNodePtyModule = yield* NodePtyModuleLoaderRef;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const architecture = yield* HostProcess.Architecture;

  const nodePty = yield* Effect.tryPromise({
    try: loadNodePtyModule,
    catch: (cause) =>
      new NodePtyModuleLoadError({
        platform,
        architecture,
        cause,
      }),
  }).pipe(Effect.orDie);

  const ensureNodePtySpawnHelperExecutableCached = yield* Effect.cached(
    ensureNodePtySpawnHelperExecutable().pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(HostProcess.Platform, platform),
      Effect.provideService(HostProcess.Architecture, architecture),
      Effect.orElseSucceed(() => undefined),
    ),
  );

  return PtyAdapter.PtyAdapter.of({
    spawn: Effect.fn("NodePtyAdapter.spawn")(function* (input) {
      yield* ensureNodePtySpawnHelperExecutableCached;
      // ConPTY ignores node-pty's name option for TERM; set it explicitly to avoid missing/16-color values.
      const env =
        platform === "win32" && input.env["TERM"] === undefined
          ? { ...input.env, TERM: "xterm-256color" }
          : input.env;
      const ptyProcess = yield* Effect.try({
        try: () => {
          const nativeProcess = nodePty.spawn(input.shell, input.args ?? [], {
            cwd: input.cwd,
            cols: input.cols,
            rows: input.rows,
            env,
            name: "xterm-256color",
          });
          return {
            nativeProcess,
            process: new NodePtyProcess(nativeProcess, platform, input.signalProcessGroup === true),
          };
        },
        catch: (cause) =>
          new PtyAdapter.PtySpawnError({
            adapter: "node-pty",
            shell: input.shell,
            cause,
          }),
      });
      if (platform === "win32") {
        yield* waitForWindowsPid(ptyProcess.nativeProcess, ptyProcess.process, input.shell).pipe(
          Effect.onError(() =>
            Effect.sync(() => ptyProcess.process.disposeExitSubscription()).pipe(
              Effect.andThen(killStartingWindowsPty(ptyProcess.nativeProcess)),
            ),
          ),
        );
      }
      return ptyProcess.process;
    }),
  });
});

export const layer = Layer.effect(PtyAdapter.PtyAdapter, make());
