import { DEFAULT_SERVER_SETTINGS as SettingsDefaults } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ThreadId,
  TerminalStopError,
  WorktreeServicesError,
  type Project,
  type ProjectScript,
  type OrchestrationV2ThreadShell,
  type TerminalMetadataStreamEvent,
  type TerminalOpenInput,
  type TerminalSummary,
  type DiscoveredLocalServer,
} from "@t3tools/contracts";
import { projectScriptPortOffset } from "@t3tools/shared/projectScripts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Ports from "../preview/PortScanner.ts";
import * as Settings from "../serverSettings.ts";
import * as Terminal from "../terminal/Manager.ts";
import * as Projects from "./ProjectService.ts";
import * as Services from "./WorktreeServices.ts";

const threadId = ThreadId.make("one");
const other = ThreadId.make("two");
const projectId = ProjectId.make("project");
const script = (id = "web", overrides: Partial<ProjectScript> = {}): ProjectScript => ({
  id,
  name: id,
  command: "npm run dev",
  icon: "play",
  runOnWorktreeCreate: false,
  service: true,
  ...overrides,
});
const listener = (port: number): DiscoveredLocalServer => ({
  host: "localhost",
  port,
  url: `http://localhost:${port}`,
  pid: 5,
  processName: "node",
  terminal: null,
});

function harness(initial = [script()]) {
  let notify: (event: TerminalMetadataStreamEvent) => Effect.Effect<void> = () => Effect.void;
  const h = {
    scripts: initial,
    inputs: [] as TerminalOpenInput[],
    stops: [] as string[],
    closes: [] as string[],
    workspaceByThread: new Map<ThreadId, string | null>(),
    archived: false,
    available: true,
    listeners: [] as DiscoveredLocalServer[],
    urls: [] as DiscoveredLocalServer[],
    failStop: false,
    immediateExit: null as number | null,
    openGate: Effect.void as Effect.Effect<void>,
    scans: 0,
    inspections: 0,
    subscribed: false,
    emit: (terminal: TerminalSummary) => notify({ type: "upsert", terminal }),
  };
  const summary = (
    input: TerminalOpenInput,
    status: TerminalSummary["status"] = "running",
    exitCode: number | null = null,
  ): TerminalSummary => ({
    threadId: input.threadId,
    terminalId: input.terminalId,
    cwd: input.cwd,
    worktreePath: input.worktreePath ?? null,
    status,
    pid: status === "running" ? 5 : null,
    exitCode,
    exitSignal: null,
    hasRunningSubprocess: false,
    label: "service",
    updatedAt: "2026-10-13T00:00:00.000Z",
  });
  const project = {
    id: projectId,
    workspaceRoot: "/repo",
    scripts: [],
    deletedAt: null,
  } as unknown as Project;
  const layer = Services.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(
          FileSystem.FileSystem,
          FileSystem.makeNoop({ realPath: (path) => Effect.succeed(path) }),
        ),
        Layer.mock(Threads.ThreadManagementService)({
          getThreadShell: (id) =>
            Effect.sync(
              () =>
                ({
                  id,
                  projectId,
                  worktreePath: h.workspaceByThread.get(id) ?? null,
                  deletedAt: null,
                  archivedAt: h.archived ? "now" : null,
                  activityRunStatus: null,
                }) as unknown as OrchestrationV2ThreadShell,
            ),
        }),
        Layer.mock(Projects.ProjectService)({
          getById: () => Effect.succeed(Option.some(project)),
        }),
        Layer.mock(Settings.ServerSettingsService)({
          getSettings: Effect.sync(() => ({
            ...SettingsDefaults,
            defaultProjectScripts: h.scripts,
          })),
        }),
        Layer.mock(Ports.PortDiscovery)({
          inspectListeners: () =>
            Effect.sync(() => {
              h.inspections++;
              return { available: h.available, listeners: h.listeners };
            }),
          scan: () =>
            Effect.sync(() => {
              h.scans++;
              return h.urls;
            }),
        }),
        Layer.mock(Terminal.TerminalManager)({
          subscribeMetadata: (callback) =>
            Effect.sync(() => {
              notify = callback;
              h.subscribed = true;
              return () => {
                h.subscribed = false;
              };
            }),
          open: (input) =>
            Effect.gen(function* () {
              h.inputs.push(input);
              yield* h.openGate;
              yield* h.emit(summary(input));
              if (h.immediateExit !== null)
                yield* h.emit(summary(input, "exited", h.immediateExit));
              return { ...summary(input), history: "output" };
            }),
          stop: (target) =>
            Effect.gen(function* () {
              h.stops.push(target.terminalId);
              if (h.failStop) return yield* new TerminalStopError({ ...target, timeoutMs: 1 });
              const input = h.inputs.find((input) => input.terminalId === target.terminalId);
              if (input) yield* h.emit(summary(input, "exited", 0));
            }),
          close: (target) =>
            Effect.gen(function* () {
              h.closes.push(target.terminalId!);
              yield* notify({
                type: "remove",
                threadId: target.threadId,
                terminalId: target.terminalId!,
              });
            }),
        }),
      ),
    ),
  );
  return { ...h, state: h, layer, summary };
}

describe("worktree services", () => {
  it.effect("skips the port probe for a workspace with no app services", () => {
    const h = harness([script("ordinary", { service: false })]);
    return Effect.gen(function* () {
      const services = yield* Services.WorktreeServices;
      expect((yield* services.list({ threadId })).services).toEqual([]);
      expect(h.state.inspections).toBe(0);
      expect(h.state.scans).toBe(0);
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("keeps legacy actions out and shares concurrent starts across threads", () => {
    const h = harness([script("ordinary", { service: false }), script()]);
    return Effect.gen(function* () {
      const services = yield* Services.WorktreeServices;
      expect((yield* services.list({ threadId })).services.map((row) => row.scriptId)).toEqual([
        "web",
      ]);
      yield* Effect.all(
        [
          services.control({ threadId, action: "start" }),
          services.control({ threadId: other, action: "start" }),
        ],
        { concurrency: "unbounded" },
      );
      expect(h.state.inputs).toHaveLength(1);
      expect((yield* services.list({ threadId: other })).services[0]?.status).toBe("running");
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("isolates worktrees and provides their effective port environment", () => {
    const h = harness([script("web", { servicePort: 3000 })]);
    h.state.workspaceByThread.set(other, "/worktree");
    return Effect.gen(function* () {
      const services = yield* Services.WorktreeServices;
      yield* services.control({ threadId, action: "start" });
      yield* services.control({ threadId: other, action: "start" });
      expect(h.state.inputs.map((input) => input.env?.PORT)).toEqual([
        "3000",
        String(3000 + projectScriptPortOffset("/worktree")),
      ]);
      expect(h.state.inputs[1]?.cwd).toBe("/worktree");
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("reports partial failures without stopping unrelated listeners", () => {
    const h = harness([script("web", { servicePort: 3000 }), script("worker")]);
    h.state.listeners = [listener(3000)];
    return Effect.gen(function* () {
      const services = yield* Services.WorktreeServices;
      const result = yield* services.control({ threadId, action: "start" });
      expect(result.services.map((row) => row.status)).toEqual(["failed", "running"]);
      // The test listener is pid 5, "node": the error names who holds the port.
      expect(result.services[0]?.error).toContain("Port 3000 is already in use by node (pid 5)");
      expect(h.state.inputs).toHaveLength(1);
      expect(h.state.stops).toEqual([]);
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("does not mistake failed port inspection for a free port", () => {
    const h = harness([script("web", { servicePort: 3000 }), script("worker")]);
    h.state.available = false;
    return Effect.gen(function* () {
      const services = yield* Services.WorktreeServices;
      const result = yield* services.control({ threadId, action: "start" });
      expect(result.inspectionAvailable).toBe(false);
      expect(result.services.map((row) => row.status)).toEqual(["failed", "running"]);
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("rejects lifecycle services and overflowing ports", () => {
    const h = harness([
      script("setup", { runOnWorktreeCreate: true }),
      script("overflow", { servicePort: 65535 }),
    ]);
    h.state.workspaceByThread.set(threadId, "/worktree");
    return Effect.gen(function* () {
      const services = yield* Services.WorktreeServices;
      const result = yield* services.control({ threadId, action: "start" });
      expect(result.services.every((row) => row.status === "failed" && row.error !== null)).toBe(
        true,
      );
      expect(h.state.inputs).toHaveLength(0);
      h.state.archived = true;
      expect(
        (yield* services.control({ threadId, action: "start" }).pipe(Effect.flip)).operation,
      ).toBe("workspace");
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("keeps removed definitions stoppable and logs available", () => {
    const h = harness();
    return Effect.gen(function* () {
      const services = yield* Services.WorktreeServices;
      yield* services.control({ threadId, action: "start" });
      h.state.scripts = [];
      const before = yield* services.list({ threadId: other });
      expect(before.services[0]).toMatchObject({ configured: false, canStop: true });
      const after = yield* services.control({ threadId: other, action: "stop" });
      expect(after.services[0]).toMatchObject({
        configured: false,
        canStop: false,
        status: "stopped",
        terminal: before.services[0]?.terminal,
      });
      expect(h.state.closes).toEqual([]);
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("blocks replacement on failed stop, then recycles the old session on retry", () => {
    const h = harness();
    return Effect.gen(function* () {
      const services = yield* Services.WorktreeServices;
      yield* services.control({ threadId, action: "start" });
      h.state.failStop = true;
      expect((yield* services.control({ threadId, action: "restart" })).services[0]).toMatchObject({
        status: "failed",
        canStop: true,
      });
      expect(h.state.inputs).toHaveLength(1);
      h.state.failStop = false;
      yield* services.control({ threadId, action: "restart" });
      expect(h.state.inputs).toHaveLength(2);
      expect(h.state.closes).toEqual([h.state.inputs[0]?.terminalId]);
      yield* h.state.emit(h.summary(h.state.inputs[0]!, "exited", 7));
      expect((yield* services.list({ threadId })).services[0]?.status).toBe("running");
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("preserves an immediate process failure instead of overwriting it with running", () => {
    const h = harness();
    h.state.immediateExit = 7;
    return Effect.gen(function* () {
      const services = yield* Services.WorktreeServices;
      const result = yield* services.control({ threadId, action: "start" });
      expect(result.services[0]).toMatchObject({ status: "failed", exitCode: 7 });
    }).pipe(Effect.provide(h.layer));
  });

  it.effect(
    "reserves a port before concurrent workspace probes and retains accepted work after disconnect",
    () => {
      const h = harness([script("web", { servicePort: 3000 })]);
      h.state.workspaceByThread.set(other, "/second");
      return Effect.gen(function* () {
        const services = yield* Services.WorktreeServices;
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        h.state.openGate = Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        );
        const request = yield* services
          .control({ threadId, action: "start" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(request);
        h.state.scripts = [
          script("web", { servicePort: 3000 - projectScriptPortOffset("/second") }),
        ];
        const conflict = yield* services.control({ threadId: other, action: "start" });
        expect(conflict.services[0]?.error).toContain("reserved");
        yield* Deferred.succeed(release, undefined);
        // A following control acquires the same lock after the accepted start.
        yield* services.control({ threadId, action: "stop" });
        expect(h.state.inputs).toHaveLength(1);
        expect(h.state.stops).toContain(h.state.inputs[0]?.terminalId);
      }).pipe(Effect.provide(h.layer));
    },
  );

  it.effect(
    "honors the authorization check inside the operation and stops polling after unsubscription",
    () => {
      const h = harness();
      return Effect.gen(function* () {
        const services = yield* Services.WorktreeServices;
        expect(
          (yield* services
            .control(
              { threadId, action: "start" },
              Effect.fail(new WorktreeServicesError({ operation: "authorize" })),
            )
            .pipe(Effect.flip)).operation,
        ).toBe("authorize");
        expect(h.state.inputs).toHaveLength(0);
        yield* services.watch({ threadId }).pipe(Stream.take(1), Stream.runCollect);
        const scans = h.state.scans;
        yield* TestClock.adjust("10 seconds");
        expect(h.state.scans).toBe(scans);
      }).pipe(Effect.provide(Layer.mergeAll(h.layer, TestClock.layer())));
    },
  );
});
