import {
  type OrchestrationV2ConversationMessage,
  type ThreadId,
  VetError,
  type VetFinding,
  VetRun,
  type VetRunInput,
  type VetSnapshot,
  type VetThreadInput,
  type VetUpdateFindingInput,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";

/**
 * Runs the user's vet wrapper (`vet-judge.sh`) against a thread's workspace and keeps the
 * thread's latest review, with the user's verdict on each finding, under the state directory.
 */
export class VetService extends Context.Service<
  VetService,
  {
    readonly get: (input: VetThreadInput) => Effect.Effect<VetSnapshot, VetError>;
    readonly watch: (input: VetThreadInput) => Stream.Stream<VetSnapshot, VetError>;
    /** Starts a review in the background and returns as soon as it is running. */
    readonly run: (input: VetRunInput) => Effect.Effect<VetSnapshot, VetError>;
    readonly cancel: (input: VetThreadInput) => Effect.Effect<VetSnapshot, VetError>;
    readonly updateFinding: (input: VetUpdateFindingInput) => Effect.Effect<VetSnapshot, VetError>;
  }
>()("t3/vet/VetService") {}

/** Reviews take 5–15 minutes; a stuck reviewer CLI must not hold the thread forever. */
const RUN_TIMEOUT = "45 minutes";
const MAX_GOAL_LENGTH = 8_000;

const VetResultFile = Schema.Struct({
  issues: Schema.Array(
    Schema.Struct({
      issue_code: Schema.optional(Schema.NullOr(Schema.String)),
      severity: Schema.optional(Schema.NullOr(Schema.Number)),
      confidence: Schema.optional(Schema.NullOr(Schema.Number)),
      file_path: Schema.optional(Schema.NullOr(Schema.String)),
      line_number: Schema.optional(Schema.NullOr(Schema.Number)),
      description: Schema.String,
    }),
  ),
  below_threshold: Schema.optional(Schema.Number),
});
const decodeResultFile = Schema.decodeUnknownEffect(Schema.fromJsonString(VetResultFile));
const StoredRun = Schema.fromJsonString(VetRun);
const decodeStoredRun = Schema.decodeUnknownEffect(StoredRun);
const encodeStoredRun = Schema.encodeEffect(StoredRun);

/** The findings in a wrapper result file, most severe first. */
const parseVetResult = (runId: string, text: string) =>
  decodeResultFile(text).pipe(
    Effect.map((result) => ({
      findings: result.issues
        .map((issue, index): VetFinding => ({
          id: `${runId}-${index}`,
          issueCode: issue.issue_code ?? "issue",
          severity: Math.min(5, Math.max(1, Math.round(issue.severity ?? 3))),
          confidence: Math.min(1, Math.max(0, issue.confidence ?? 0)),
          filePath: issue.file_path || null,
          line:
            issue.line_number === null || issue.line_number === undefined
              ? null
              : Math.max(1, Math.round(issue.line_number)),
          description: issue.description,
          status: "open",
          note: null,
        }))
        .toSorted((a, b) => b.severity - a.severity || b.confidence - a.confidence),
      belowThreshold:
        result.below_threshold === undefined
          ? null
          : Math.max(0, Math.round(result.below_threshold)),
    })),
  );

/** The thread's conversation in the JSONL message format vet's history loaders print. */
const vetHistoryJsonl = (messages: ReadonlyArray<OrchestrationV2ConversationMessage>) =>
  messages
    .filter((message) => message.role !== "system" && message.text.trim().length > 0)
    .map((message) =>
      JSON.stringify(
        message.role === "user"
          ? { object_type: "ChatInputUserMessage", text: message.text }
          : {
              object_type: "ResponseBlockAgentMessage",
              role: "assistant",
              assistant_message_id: message.id,
              content: [{ object_type: "TextBlock", type: "text", text: message.text }],
            },
      ),
    )
    .join("\n");

/** The last few lines the wrapper printed, which name why a review failed. */
const failureSummary = (stderr: string) => {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("vet-judge: exit="));
  const summary = lines.slice(-3).join("\n");
  return summary.length > 600 ? summary.slice(-600) : summary || null;
};

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const runner = yield* ProcessRunner.ProcessRunner;
  const scope = yield* Scope.Scope;
  const locks = yield* KeyedLock.make<ThreadId>();
  const changes = yield* PubSub.unbounded<ThreadId>();
  const environment = yield* HostProcess.Environment;
  const home = yield* HostProcess.HomeDirectory;

  // Resolved once: the wrapper runs from each thread's worktree, not the server's directory.
  const scriptPath = path.resolve(
    environment.T3CODE_VET_SCRIPT?.trim() ||
      path.join(home, ".agents", "skills", "vet", "scripts", "vet-judge.sh"),
  );
  const directory = path.join(config.stateDir, "vet");
  // Thread ids are free-form; encoding keeps separators and `:` out of file names.
  const storageFile = (threadId: ThreadId, suffix: string) =>
    path.join(directory, `${encodeURIComponent(threadId)}${suffix}`);
  const runs = new Map<ThreadId, VetRun | null>();
  const active = new Map<ThreadId, { readonly runId: string; readonly fiber: Fiber.Fiber<void> }>();

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const scriptInstalled = fs.exists(scriptPath).pipe(Effect.orElseSucceed(() => false));

  /** Makes a run the thread's current state, in memory and for watchers. */
  const commit = (threadId: ThreadId, run: VetRun) =>
    Effect.sync(() => runs.set(threadId, run)).pipe(
      Effect.andThen(PubSub.publish(changes, threadId)),
    );

  /** Persists a run, then commits it, so a failed write leaves the previous state in place. */
  const save = Effect.fn("VetService.save")(function* (threadId: ThreadId, run: VetRun) {
    const contents = yield* encodeStoredRun(run).pipe(
      Effect.mapError((cause) => new VetError({ operation: "write", cause })),
    );
    yield* writeFileStringAtomically({ filePath: storageFile(threadId, ".json"), contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError((cause) => new VetError({ operation: "write", cause })),
    );
    yield* commit(threadId, run);
  });

  /** A run that ended must not look like it is still running, even when the disk refuses it. */
  const saveEnded = (threadId: ThreadId, run: VetRun) =>
    save(threadId, run).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("vet run state could not be saved", { cause }).pipe(
          Effect.andThen(commit(threadId, run)),
        ),
      ),
    );

  const load = Effect.fn("VetService.load")(function* (threadId: ThreadId) {
    const cached = runs.get(threadId);
    if (cached !== undefined) return cached;
    const file = storageFile(threadId, ".json");
    const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      // A run may have started while this looked; never replace it with an older read.
      if (!runs.has(threadId)) runs.set(threadId, null);
      return runs.get(threadId) ?? null;
    }
    const text = yield* fs
      .readFileString(file)
      .pipe(Effect.mapError((cause) => new VetError({ operation: "read", cause })));
    const stored = yield* decodeStoredRun(text).pipe(
      Effect.mapError((cause) => new VetError({ operation: "read", cause })),
    );
    // Nothing runs reviews before the first load, so a running review on disk outlived its server.
    const run: VetRun =
      stored.status === "running" && !active.has(threadId)
        ? {
            ...stored,
            status: "failed",
            finishedAt: yield* now,
            error: "The server stopped during this review.",
          }
        : stored;
    const current = runs.get(threadId);
    if (current !== undefined) return current;
    runs.set(threadId, run);
    return run;
  });

  const snapshot = Effect.fn("VetService.snapshot")(function* (threadId: ThreadId) {
    const available = yield* scriptInstalled;
    return { threadId, scriptPath, available, run: yield* load(threadId) } satisfies VetSnapshot;
  });

  const workspace = Effect.fn("VetService.workspace")(function* (threadId: ThreadId) {
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError((cause) => new VetError({ operation: "read", cause })));
    if (!shell || shell.deletedAt !== null) return yield* new VetError({ operation: "workspace" });
    const project = yield* projects
      .get(shell.projectId)
      .pipe(Effect.mapError((cause) => new VetError({ operation: "read", cause })));
    if (Option.isNone(project)) return yield* new VetError({ operation: "workspace" });
    const cwd = shell.worktreePath ?? project.value.workspaceRoot;
    if (!(yield* fs.exists(cwd).pipe(Effect.orElseSucceed(() => false))))
      return yield* new VetError({ operation: "workspace" });
    const { messages } = yield* threads
      .getProjectThreadRecords({ projectId: shell.projectId, threadId }, ["messages"])
      .pipe(Effect.mapError((cause) => new VetError({ operation: "read", cause })));
    const settled = messages
      .filter((message) => !message.streaming)
      .toSorted(
        (a, b) => DateTime.toEpochMillis(a.createdAt) - DateTime.toEpochMillis(b.createdAt),
      );
    const firstRequest = settled.find(
      (message) => message.role === "user" && message.text.trim().length > 0,
    );
    return {
      cwd,
      defaultGoal: (firstRequest?.text.trim() || shell.title).slice(0, MAX_GOAL_LENGTH),
      history: vetHistoryJsonl(settled),
    };
  });

  /** Records how a review ended, unless it was cancelled or replaced meanwhile. */
  const settle = (threadId: ThreadId, runId: string, outcome: Partial<VetRun>) =>
    locks.withLock(
      threadId,
      Effect.gen(function* () {
        const current = yield* load(threadId);
        if (current?.id !== runId || current.status !== "running") return;
        yield* saveEnded(threadId, { ...current, ...outcome, finishedAt: yield* now });
      }),
    );

  const execute = (threadId: ThreadId, run: VetRun, cwd: string, historyPath: string) =>
    runner
      .run({
        command: "bash",
        // The wrapper parses any argument starting with `-` as an option, goal included.
        args: [
          scriptPath,
          run.goal.startsWith("-") ? `Goal: ${run.goal}` : run.goal,
          "--reviewer",
          run.reviewer,
          "--history-file",
          historyPath,
        ],
        cwd,
        timeout: RUN_TIMEOUT,
        forceKillAfter: "5 seconds",
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 4 * 1024 * 1024,
        outputMode: "truncate",
      })
      .pipe(
        Effect.flatMap((output) =>
          Effect.gen(function* () {
            if (output.timedOut)
              return { status: "failed", error: "The review timed out." } as const;
            const code = output.code === null ? null : Number(output.code);
            if (code !== 0 && code !== 10)
              return {
                status: "failed",
                error: failureSummary(output.stderr) ?? `The wrapper exited with code ${code}.`,
              } as const;
            const resultPath = /results (.+\.json), raw log /.exec(output.stderr)?.[1];
            const text = resultPath
              ? yield* fs.readFileString(resultPath).pipe(Effect.orElseSucceed(() => ""))
              : "";
            const parsed = yield* parseVetResult(run.id, text).pipe(Effect.option);
            if (Option.isNone(parsed))
              return { status: "failed", error: "Could not read the review's results." } as const;
            return {
              status: parsed.value.findings.length === 0 ? "clean" : "issues",
              findings: parsed.value.findings,
              belowThreshold: parsed.value.belowThreshold,
            } as const;
          }),
        ),
        Effect.catch((cause) =>
          Effect.logWarning("vet wrapper failed to run", { cause }).pipe(
            Effect.as({ status: "failed", error: "Could not start the vet wrapper." } as const),
          ),
        ),
        Effect.flatMap((outcome) => settle(threadId, run.id, outcome)),
        Effect.catch((cause) => Effect.logWarning("vet result could not be saved", { cause })),
        Effect.ensuring(
          Effect.sync(() => {
            if (active.get(threadId)?.runId === run.id) active.delete(threadId);
          }),
        ),
      );

  const run = Effect.fn("VetService.run")(function* (input: VetRunInput) {
    yield* locks.withLock(
      input.threadId,
      Effect.gen(function* () {
        if (!(yield* scriptInstalled)) return yield* new VetError({ operation: "not-installed" });
        if ((yield* load(input.threadId))?.status === "running")
          return yield* new VetError({ operation: "busy" });
        const target = yield* workspace(input.threadId);
        const historyPath = storageFile(input.threadId, ".history.jsonl");
        yield* writeFileStringAtomically({ filePath: historyPath, contents: target.history }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.mapError((cause) => new VetError({ operation: "write", cause })),
        );
        const id = yield* crypto
          .randomUUIDv4()
          .pipe(Effect.mapError((cause) => new VetError({ operation: "write", cause })));
        const started: VetRun = {
          id,
          reviewer: input.reviewer ?? "codex",
          goal: input.goal ?? target.defaultGoal,
          status: "running",
          startedAt: yield* now,
          finishedAt: null,
          error: null,
          findings: [],
          belowThreshold: null,
        };
        // A saved running review always gets its runner, even if the request is interrupted.
        yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            yield* save(input.threadId, started);
            // The review belongs to the service's lifetime, not the request that started it.
            const fiber = yield* restore(
              execute(input.threadId, started, target.cwd, historyPath),
            ).pipe(Effect.forkIn(scope));
            active.set(input.threadId, { runId: id, fiber });
          }),
        );
      }),
    );
    return yield* snapshot(input.threadId);
  });

  const cancel = Effect.fn("VetService.cancel")(function* (input: VetThreadInput) {
    // Once a stop is accepted it finishes, even if the caller disconnects.
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const stopping = yield* locks.withLock(
          input.threadId,
          Effect.gen(function* () {
            const current = yield* load(input.threadId);
            if (current?.status !== "running") return null;
            const entry = active.get(input.threadId) ?? null;
            active.delete(input.threadId);
            yield* saveEnded(input.threadId, {
              ...current,
              status: "cancelled",
              finishedAt: yield* now,
            });
            return entry;
          }),
        );
        // Interrupting kills the wrapper's process group, reviewer CLI included.
        if (stopping) yield* Fiber.interrupt(stopping.fiber);
      }),
    );
    return yield* snapshot(input.threadId);
  });

  const updateFinding = Effect.fn("VetService.updateFinding")(function* (
    input: VetUpdateFindingInput,
  ) {
    yield* locks.withLock(
      input.threadId,
      Effect.gen(function* () {
        const current = yield* load(input.threadId);
        if (
          current?.id !== input.runId ||
          !current.findings.some((finding) => finding.id === input.findingId)
        )
          return yield* new VetError({ operation: "not-found" });
        const note = input.status === "dismissed" ? input.note?.trim() || null : null;
        yield* save(input.threadId, {
          ...current,
          findings: current.findings.map((finding) =>
            finding.id === input.findingId ? { ...finding, status: input.status, note } : finding,
          ),
        });
      }),
    );
    return yield* snapshot(input.threadId);
  });

  const watch = (input: VetThreadInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe first so a change between the snapshot and the subscription is not lost.
        const subscription = yield* PubSub.subscribe(changes);
        const first = yield* snapshot(input.threadId);
        return Stream.concat(
          Stream.make(first),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((threadId) => threadId === input.threadId),
            Stream.mapEffect(() => snapshot(input.threadId)),
          ),
        );
      }),
    );

  return VetService.of({
    get: Effect.fn("VetService.get")((input) => snapshot(input.threadId)),
    watch,
    run,
    cancel,
    updateFinding,
  });
});

export const layer = Layer.effect(VetService, make);
