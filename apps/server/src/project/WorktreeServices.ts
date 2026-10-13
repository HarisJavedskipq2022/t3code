import {
  type DiscoveredLocalServer,
  WorktreeServicesError,
  type ProjectScript,
  type ThreadId,
  type WorktreeService,
  type WorktreeServiceControlInput,
  type WorktreeServicesInput,
  type WorktreeServicesSnapshot,
  type TerminalSummary,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import {
  projectScriptPortOffset,
  projectScriptRuntimeEnv,
  resolveProjectScripts,
} from "@t3tools/shared/projectScripts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as PortScanner from "../preview/PortScanner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Terminal from "../terminal/Manager.ts";
import * as Projects from "./ProjectService.ts";

export class WorktreeServices extends Context.Service<
  WorktreeServices,
  {
    readonly list: (
      input: WorktreeServicesInput,
    ) => Effect.Effect<WorktreeServicesSnapshot, WorktreeServicesError>;
    readonly watch: (
      input: WorktreeServicesInput,
    ) => Stream.Stream<WorktreeServicesSnapshot, WorktreeServicesError>;
    readonly control: (
      input: WorktreeServiceControlInput,
      authorize?: Effect.Effect<void, WorktreeServicesError>,
    ) => Effect.Effect<WorktreeServicesSnapshot, WorktreeServicesError>;
  }
>()("t3/project/WorktreeServices") {}

interface Workspace {
  path: string;
  root: string;
  worktreePath: string | null;
  scripts: readonly ProjectScript[];
  available: boolean;
}
interface ManagedService {
  workspacePath: string;
  row: { -readonly [K in keyof WorktreeService]: WorktreeService[K] };
}

/** " by node (pid 123)", or nothing when the probe could not name the process. */
function listenerOwnerLabel(listener: DiscoveredLocalServer): string {
  if (listener.processName && listener.pid !== null) {
    return ` by ${listener.processName} (pid ${listener.pid})`;
  }
  return listener.pid !== null ? ` by pid ${listener.pid}` : "";
}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* Projects.ProjectService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const terminals = yield* Terminal.TerminalManager;
  const ports = yield* PortScanner.PortDiscovery;
  const scope = yield* Scope.Scope;
  const locks = yield* KeyedLock.make<string>();
  const workspaces = new Map<string, Map<string, ManagedService>>();
  const bindings = new Map<ThreadId, Workspace>();
  const reservations = new Map<number, ManagedService>();

  const resolve = Effect.fn("WorktreeServices.resolve")(function* (threadId: ThreadId) {
    const thread = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError((cause) => new WorktreeServicesError({ operation: "read", cause })));
    if (!thread) {
      const previous = bindings.get(threadId);
      if (previous) return { ...previous, available: false, scripts: [] };
      return yield* new WorktreeServicesError({ operation: "workspace" });
    }
    const project = yield* projects
      .getById(thread.projectId)
      .pipe(Effect.mapError((cause) => new WorktreeServicesError({ operation: "read", cause })));
    if (Option.isNone(project)) {
      const previous = bindings.get(threadId);
      if (previous) return { ...previous, available: false, scripts: [] };
      return yield* new WorktreeServicesError({ operation: "workspace" });
    }
    const config = yield* settings.getSettings.pipe(
      Effect.mapError((cause) => new WorktreeServicesError({ operation: "read", cause })),
    );
    const cwd = thread.worktreePath ?? project.value.workspaceRoot;
    const canonical = yield* fs.realPath(cwd).pipe(Effect.option);
    const previous = bindings.get(threadId);
    const workspace: Workspace = {
      path: Option.getOrElse(canonical, () => previous?.path ?? cwd),
      root: project.value.workspaceRoot,
      worktreePath: thread.worktreePath === null ? null : Option.getOrElse(canonical, () => cwd),
      scripts: resolveProjectScripts(config, project.value).filter((script) => script.service),
      available:
        Option.isSome(canonical) &&
        thread.deletedAt === null &&
        thread.archivedAt === null &&
        thread.activityRunStatus !== "preparing",
    };
    bindings.set(threadId, workspace);
    return workspace;
  });

  const recordsFor = (workspacePath: string) => {
    let records = workspaces.get(workspacePath);
    if (!records) {
      records = new Map();
      workspaces.set(workspacePath, records);
    }
    return records;
  };
  const configurationError = (script: ProjectScript, workspace: Workspace) => {
    if (script.runOnWorktreeCreate || script.runOnSettle)
      return "An app service cannot also be a setup or settle action.";
    if (
      script.servicePort !== undefined &&
      script.servicePort + projectScriptPortOffset(workspace.worktreePath) > 65535
    )
      return "The base port plus this worktree's offset exceeds 65535.";
    return null;
  };
  const configuredRow = (script: ProjectScript, workspace: Workspace): WorktreeService => ({
    scriptId: script.id,
    name: script.name,
    configured: true,
    status: "stopped",
    canStop: false,
    terminal: null,
    expectedPort:
      script.servicePort === undefined || configurationError(script, workspace)
        ? null
        : script.servicePort + projectScriptPortOffset(workspace.worktreePath),
    ports: [],
    urls: [],
    exitCode: null,
    error: configurationError(script, workspace),
  });
  const releasePort = (record: ManagedService) => {
    const port = record.row.expectedPort;
    if (port !== null && reservations.get(port) === record) reservations.delete(port);
  };

  const stop = Effect.fn("WorktreeServices.stop")(function* (
    record: ManagedService,
    preserveExit = false,
  ) {
    const target = record.row.terminal;
    if (!target) return true;
    const previous = { status: record.row.status, error: record.row.error };
    record.row.status = "stopping";
    const stopped = yield* terminals.stop(target).pipe(Effect.result);
    if (stopped._tag === "Failure") {
      record.row.status = "failed";
      record.row.canStop = true;
      record.row.error = "The service did not stop. Retry Stop before starting it again.";
      yield* Effect.logWarning("worktree service stop failed", { cause: stopped.failure });
      return false;
    }
    record.row.status = preserveExit ? previous.status : "stopped";
    record.row.error = preserveExit ? previous.error : null;
    record.row.canStop = false;
    releasePort(record);
    return true;
  });

  const start = Effect.fn("WorktreeServices.start")(function* (
    workspace: Workspace,
    threadId: ThreadId,
    script: ProjectScript,
  ) {
    const records = recordsFor(workspace.path);
    let record = records.get(script.id);
    if (record?.row.status === "running" || record?.row.status === "starting") return;
    if (record && !(yield* stop(record))) return;
    const oldTerminal = record?.row.terminal ?? null;
    if (!record) {
      record = { workspacePath: workspace.path, row: { ...configuredRow(script, workspace) } };
      records.set(script.id, record);
    }
    record.row = { ...configuredRow(script, workspace), terminal: oldTerminal };
    const invalid = configurationError(script, workspace);
    if (invalid) {
      record.row.status = "failed";
      return;
    }
    const expectedPort = record.row.expectedPort;
    if (expectedPort !== null) {
      const reserved = reservations.get(expectedPort);
      if (reserved && reserved !== record) {
        record.row.status = "failed";
        record.row.error = `Port ${expectedPort} is reserved by another app service.`;
        return;
      }
      // Reserve before the OS probe yields; other workspace locks share this map.
      reservations.set(expectedPort, record);
      const inspection = yield* ports.inspectListeners({ refresh: true });
      const owner = inspection.listeners.find((listener) => listener.port === expectedPort);
      if (!inspection.available || owner) {
        releasePort(record);
        record.row.status = "failed";
        record.row.error = owner
          ? `Port ${expectedPort} is already in use${listenerOwnerLabel(owner)}. Stop it or choose another base port.`
          : "Could not inspect listening ports. Try starting the service again.";
        return;
      }
    }
    if (oldTerminal) {
      record.row.terminal = null;
      yield* terminals.close(oldTerminal).pipe(Effect.ignore);
    }
    const target = {
      threadId,
      terminalId: `service-${yield* crypto.randomUUIDv4.pipe(Effect.mapError((cause) => new WorktreeServicesError({ operation: "read", cause })))}`,
    };
    record.row.terminal = target;
    record.row.status = "starting";
    record.row.canStop = true;
    const env = projectScriptRuntimeEnv({
      project: { cwd: workspace.root },
      worktreePath: workspace.worktreePath,
    });
    if (expectedPort !== null) {
      env.PORT = String(expectedPort);
      env.T3CODE_SERVICE_PORT = String(expectedPort);
    }
    const opened = yield* terminals
      .open({
        ...target,
        cwd: workspace.path,
        worktreePath: workspace.worktreePath,
        env,
        command: script.command,
      })
      .pipe(Effect.result);
    if (opened._tag === "Failure") {
      record.row.status = "failed";
      record.row.error = "Could not start the service. Check its command and workspace.";
      yield* Effect.logWarning("worktree service start failed", { cause: opened.failure });
      yield* stop(record, true);
    } else if (record.row.status === "starting") {
      record.row.status = opened.success.status === "running" ? "running" : "failed";
      record.row.exitCode = opened.success.exitCode;
      if (record.row.status === "failed") {
        record.row.error = "The service exited before it could start. Check its logs.";
        yield* stop(record, true);
      }
    }
  });

  const snapshot = Effect.fn("WorktreeServices.snapshot")(function* (
    workspace: Workspace,
  ): Effect.fn.Return<WorktreeServicesSnapshot> {
    // Every open thread panel watches this; skip the OS port probe when there is nothing to show.
    if (workspace.scripts.length === 0 && (workspaces.get(workspace.path)?.size ?? 0) === 0) {
      return { workspacePath: workspace.path, inspectionAvailable: true, services: [] };
    }
    const raw = yield* ports.inspectListeners();
    const web = yield* ports.scan();
    const configured = new Map(workspace.scripts.map((script) => [script.id, script]));
    const rows = new Map(
      workspace.scripts.map((script) => [script.id, configuredRow(script, workspace)]),
    );
    for (const [id, record] of workspaces.get(workspace.path) ?? []) {
      const script = configured.get(id);
      const target = record.row.terminal;
      const owned = (listener: (typeof raw.listeners)[number]) =>
        target !== null &&
        listener.terminal?.threadId === target.threadId &&
        listener.terminal.terminalId === target.terminalId;
      rows.set(id, {
        ...record.row,
        name: script?.name ?? record.row.name,
        configured: script !== undefined,
        ports: raw.available
          ? [...new Set(raw.listeners.filter(owned).map((listener) => listener.port))].sort(
              (a, b) => a - b,
            )
          : [],
        urls: web.filter(owned),
        error: record.row.error ?? (script ? configurationError(script, workspace) : null),
      });
    }
    return {
      workspacePath: workspace.path,
      inspectionAvailable: raw.available,
      services: [...rows.values()],
    };
  });
  const list = Effect.fn("WorktreeServices.list")(function* (input: WorktreeServicesInput) {
    return yield* snapshot(yield* resolve(input.threadId));
  });

  const control = Effect.fn("WorktreeServices.control")(function* (
    input: WorktreeServiceControlInput,
    authorize: Effect.Effect<void, WorktreeServicesError> = Effect.void,
  ) {
    const workspace = yield* resolve(input.threadId);
    // Accepted work belongs to the service lifetime, not a socket's request fiber.
    const operation = locks.withLock(
      workspace.path,
      Effect.gen(function* () {
        yield* authorize;
        const current = yield* resolve(input.threadId);
        if (current.path !== workspace.path || (input.action !== "stop" && !current.available))
          return yield* new WorktreeServicesError({ operation: "workspace" });
        const records = recordsFor(current.path);
        const scripts = current.scripts.filter(
          (script) => input.scriptId === undefined || script.id === input.scriptId,
        );
        if (
          input.scriptId !== undefined &&
          (input.action === "stop"
            ? !records.has(input.scriptId) && scripts.length === 0
            : scripts.length === 0)
        )
          return yield* new WorktreeServicesError({ operation: "invalid-request" });
        const blocked = new Set<string>();
        if (input.action !== "start") {
          for (const [id, record] of records) {
            if (input.scriptId !== undefined && id !== input.scriptId) continue;
            if (!(yield* stop(record))) blocked.add(id);
          }
        }
        if (input.action !== "stop") {
          for (const script of scripts) {
            if (!blocked.has(script.id)) yield* start(current, input.threadId, script);
          }
        }
        return yield* snapshot(current);
      }),
    );
    return yield* operation.pipe(Effect.forkIn(scope), Effect.flatMap(Fiber.join));
  });

  const updateTerminal = Effect.fn("WorktreeServices.updateTerminal")(function* (
    terminal: TerminalSummary,
  ) {
    for (const records of workspaces.values()) {
      for (const record of records.values()) {
        const target = record.row.terminal;
        if (
          !target ||
          target.threadId !== terminal.threadId ||
          target.terminalId !== terminal.terminalId
        )
          continue;
        record.row.exitCode = terminal.exitCode;
        if (record.row.status === "stopping") continue;
        if (terminal.status === "running") {
          record.row.status = "running";
        } else if (terminal.status === "exited" || terminal.status === "error") {
          record.row.status =
            terminal.status === "exited" && terminal.exitCode === 0 ? "stopped" : "failed";
          record.row.error =
            record.row.status === "failed" ? "The service exited. Check its logs." : null;
          // Never await a terminal mutation from its own synchronous event callback.
          yield* locks
            .withLock(
              record.workspacePath,
              Effect.gen(function* () {
                if (record.row.terminal !== target || record.row.status === "running") return;
                yield* stop(record, true);
              }),
            )
            .pipe(Effect.forkIn(scope));
        }
      }
    }
  });
  yield* Effect.acquireRelease(
    terminals.subscribeMetadata((event) => {
      if (event.type === "snapshot")
        return Effect.forEach(event.terminals, updateTerminal, { discard: true });
      if (event.type === "upsert") return updateTerminal(event.terminal);
      return Effect.sync(() => {
        for (const records of workspaces.values())
          for (const record of records.values()) {
            if (
              record.row.terminal?.threadId !== event.threadId ||
              record.row.terminal.terminalId !== event.terminalId
            )
              continue;
            record.row.status = "stopped";
            record.row.canStop = false;
            record.row.terminal = null;
            releasePort(record);
          }
      });
    }),
    (unsubscribe) => Effect.sync(unsubscribe),
  );

  return WorktreeServices.of({
    list,
    control,
    watch: (input) =>
      Stream.fromEffectSchedule(list(input), Schedule.spaced("3 seconds")).pipe(
        Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      ),
  });
});

export const layer = Layer.effect(WorktreeServices, make);
