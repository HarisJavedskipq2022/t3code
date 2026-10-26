import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2ThreadShell,
  type VetSnapshot,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Vet from "./VetService.ts";

const threadId = ThreadId.make("thread-vet");
const projectId = ProjectId.make("project-vet");

/** A stand-in for vet-judge.sh whose behavior is picked by the goal it is given. */
const fakeWrapper = (dir: string) => `#!/usr/bin/env bash
mode="$1"; shift
printf '%s\\n' "$mode" "$@" > "${dir}/args"
while [ $# -gt 0 ]; do
  [ "$1" = "--history-file" ] && cp "$2" "${dir}/history"
  shift
done
case "$mode" in
  issues)
    cat > "${dir}/run.json" <<'JSON'
{"issues": [
  {"issue_code": "nit", "severity": 1.0, "confidence": 0.7, "file_path": "src/a.ts", "line_number": 3, "description": "Minor"},
  {"issue_code": "logic_error", "severity": 4, "confidence": 0.9, "file_path": "src/b.ts", "line_number": 12, "description": "Wrong branch"},
  {"issue_code": "missing", "severity": 3, "confidence": 0.8, "file_path": null, "line_number": null, "description": "No test"}
], "below_threshold": 2}
JSON
    echo "vet-judge: exit=10, results ${dir}/run.json, raw log ${dir}/run.log" >&2
    exit 10 ;;
  clean)
    echo '{"issues": []}' > "${dir}/run.json"
    echo "vet-judge: exit=0, results ${dir}/run.json, raw log ${dir}/run.log" >&2
    exit 0 ;;
  broken)
    echo "codex: usage limit reached, try again later" >&2
    echo "vet-judge: exit=1, results ${dir}/run.json, raw log ${dir}/run.log" >&2
    exit 1 ;;
  hang)
    echo $$ > "${dir}/pid"
    sleep 60 ;;
esac
`;

const message = (
  id: string,
  role: "user" | "assistant",
  text: string,
  seconds: number,
): OrchestrationV2ConversationMessage =>
  ({
    id: MessageId.make(id),
    threadId,
    role,
    text,
    streaming: false,
    createdAt: DateTime.makeUnsafe(seconds * 1000),
  }) as unknown as OrchestrationV2ConversationMessage;

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // A space in every path checks the result line is parsed whole.
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3 vet " });
  const workspace = path.join(root, "workspace");
  const tools = path.join(root, "tools");
  yield* fs.makeDirectory(workspace, { recursive: true });
  yield* fs.makeDirectory(tools, { recursive: true });
  const script = path.join(tools, "vet-judge.sh");
  yield* fs.writeFileString(script, fakeWrapper(tools));
  const read = (name: string) => fs.readFileString(path.join(tools, name));

  const layer = (scriptPath = script) =>
    Vet.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ServerConfig.layerTest(workspace, path.join(root, "home")),
          ProcessRunner.layer,
          Layer.succeed(HostProcess.Environment, { T3CODE_VET_SCRIPT: scriptPath }),
          Layer.mock(Threads.ThreadManagementService)({
            getThreadShell: (id) =>
              Effect.succeed({
                id,
                projectId,
                title: "Fallback title",
                worktreePath: workspace,
                deletedAt: null,
              } as unknown as OrchestrationV2ThreadShell),
            getProjectThreadRecords: () =>
              Effect.succeed({
                messages: [
                  message("m2", "assistant", "Done, branch updated.", 2),
                  message("m1", "user", "Fix the retry loop. Do not touch the API.", 1),
                ],
              }) as never,
          }),
          Layer.mock(ProjectStore.ProjectStoreV2)({
            get: () => Effect.succeedSome({ workspaceRoot: workspace } as never),
          }),
        ),
      ),
      Layer.provide(NodeServices.layer),
    );
  return { layer, read, script, tools, home: path.join(root, "home") };
});

/** The first snapshot after the review stops running. */
const settled = Effect.gen(function* () {
  const vet = yield* Vet.VetService;
  const next = yield* vet.watch({ threadId }).pipe(
    Stream.filter((snapshot) => snapshot.run !== null && snapshot.run.status !== "running"),
    Stream.runHead,
  );
  return Option.getOrThrow(next) satisfies VetSnapshot;
});

describe("VetService", () => {
  it.live("runs the wrapper with the thread's goal and history and keeps its findings", () =>
    Effect.gen(function* () {
      const h = yield* setup;
      yield* Effect.gen(function* () {
        const vet = yield* Vet.VetService;
        const started = yield* vet.run({ threadId, goal: "issues" });
        expect(started.available).toBe(true);
        expect(started.run?.status).toBe("running");

        const done = yield* settled;
        expect(done.run?.status).toBe("issues");
        expect(done.run?.belowThreshold).toBe(2);
        expect(
          done.run?.findings.map((finding) => [finding.issueCode, finding.severity, finding.line]),
        ).toEqual([
          ["logic_error", 4, 12],
          ["missing", 3, null],
          ["nit", 1, 3],
        ]);
        expect(yield* h.read("args")).toContain("issues\n--reviewer\ncodex\n--history-file\n");
        const history = (yield* h.read("history")).split("\n").map((line) => JSON.parse(line));
        expect(history).toEqual([
          {
            object_type: "ChatInputUserMessage",
            text: "Fix the retry loop. Do not touch the API.",
          },
          expect.objectContaining({
            object_type: "ResponseBlockAgentMessage",
            role: "assistant",
            content: [{ object_type: "TextBlock", type: "text", text: "Done, branch updated." }],
          }),
        ]);
      }).pipe(Effect.provide(h.layer()));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("defaults the goal to the thread's first request and reports a clean review", () =>
    Effect.gen(function* () {
      const h = yield* setup;
      // The default goal is not a mode the fake knows, so it prints nothing; swap in "clean".
      yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          h.script,
          (yield* fs.readFileString(h.script)).replace('mode="$1"', 'mode="clean"'),
        );
        const vet = yield* Vet.VetService;
        const started = yield* vet.run({ threadId, reviewer: "claude" });
        expect(started.run?.goal).toBe("Fix the retry loop. Do not touch the API.");
        const done = yield* settled;
        expect(done.run?.status).toBe("clean");
        expect(done.run?.findings).toEqual([]);
        expect(yield* h.read("args")).toContain("--reviewer\nclaude\n");
      }).pipe(Effect.provide(h.layer()));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("shows why a review failed", () =>
    Effect.gen(function* () {
      const h = yield* setup;
      yield* Effect.gen(function* () {
        const vet = yield* Vet.VetService;
        yield* vet.run({ threadId, goal: "broken" });
        const done = yield* settled;
        expect(done.run?.status).toBe("failed");
        expect(done.run?.error).toBe("codex: usage limit reached, try again later");
      }).pipe(Effect.provide(h.layer()));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("allows one review per thread and cancelling kills the wrapper", () =>
    Effect.gen(function* () {
      const h = yield* setup;
      yield* Effect.gen(function* () {
        const vet = yield* Vet.VetService;
        const fs = yield* FileSystem.FileSystem;
        // The wrapper records its pid once it is running; watch for it before starting.
        const pidWritten = yield* fs.watch(h.tools).pipe(
          Stream.filter((event) => event.path.endsWith("pid")),
          Stream.mapEffect(() => h.read("pid").pipe(Effect.map((text) => text.trim()))),
          Stream.filter((text) => text.length > 0),
          Stream.runHead,
          Effect.forkScoped,
        );
        yield* vet.run({ threadId, goal: "hang" });
        const busy = yield* vet.run({ threadId, goal: "issues" }).pipe(Effect.flip);
        expect(busy.operation).toBe("busy");

        const pid = Number(Option.getOrThrow(yield* Fiber.join(pidWritten)));
        const cancelled = yield* vet.cancel({ threadId });
        expect(cancelled.run?.status).toBe("cancelled");
        expect(() => process.kill(pid, 0)).toThrow();

        const again = yield* vet.run({ threadId, goal: "issues" });
        expect(again.run?.status).toBe("running");
        expect((yield* settled).run?.status).toBe("issues");
      }).pipe(Effect.provide(h.layer()));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("records verdicts on findings and keeps them across restarts", () =>
    Effect.gen(function* () {
      const h = yield* setup;
      const runId = yield* Effect.gen(function* () {
        const vet = yield* Vet.VetService;
        yield* vet.run({ threadId, goal: "issues" });
        const done = yield* settled;
        const [first, second] = done.run!.findings;
        yield* vet.updateFinding({
          threadId,
          runId: done.run!.id,
          findingId: first!.id,
          status: "dismissed",
          note: "  Backend filters it  ",
        });
        const confirmed = yield* vet.updateFinding({
          threadId,
          runId: done.run!.id,
          findingId: second!.id,
          status: "confirmed",
        });
        expect(confirmed.run?.findings.map((finding) => [finding.status, finding.note])).toEqual([
          ["dismissed", "Backend filters it"],
          ["confirmed", null],
          ["open", null],
        ]);
        const stale = yield* vet
          .updateFinding({ threadId, runId: "old", findingId: first!.id, status: "open" })
          .pipe(Effect.flip);
        expect(stale.operation).toBe("not-found");
        return done.run!.id;
      }).pipe(Effect.provide(h.layer()));

      yield* Effect.gen(function* () {
        const vet = yield* Vet.VetService;
        const reloaded = yield* vet.get({ threadId });
        expect(reloaded.run?.id).toBe(runId);
        expect(reloaded.run?.findings.map((finding) => finding.status)).toEqual([
          "dismissed",
          "confirmed",
          "open",
        ]);
        const restored = yield* vet.updateFinding({
          threadId,
          runId,
          findingId: reloaded.run!.findings[0]!.id,
          status: "open",
        });
        expect(restored.run?.findings[0]).toMatchObject({ status: "open", note: null });
      }).pipe(Effect.provide(h.layer()));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("marks a review that outlived its server as failed", () =>
    Effect.gen(function* () {
      const h = yield* setup;
      yield* Effect.gen(function* () {
        const vet = yield* Vet.VetService;
        yield* vet.run({ threadId, goal: "hang" });
      }).pipe(Effect.provide(h.layer()));
      // The first service's scope closed, interrupting the wrapper mid-review.
      yield* Effect.gen(function* () {
        const vet = yield* Vet.VetService;
        const reloaded = yield* vet.get({ threadId });
        expect(reloaded.run?.status).toBe("failed");
        expect(reloaded.run?.error).toBe("The server stopped during this review.");
      }).pipe(Effect.provide(h.layer()));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("keeps free-form thread ids inside the vet directory", () =>
    Effect.gen(function* () {
      const h = yield* setup;
      const fs = yield* FileSystem.FileSystem;
      const escaping = ThreadId.make("../../escape:thread");
      yield* Effect.gen(function* () {
        const vet = yield* Vet.VetService;
        yield* vet.run({ threadId: escaping, goal: "clean" });
        const done = yield* vet.watch({ threadId: escaping }).pipe(
          Stream.filter((snapshot) => snapshot.run !== null && snapshot.run.status !== "running"),
          Stream.runHead,
        );
        expect(Option.getOrThrow(done).run?.status).toBe("clean");
      }).pipe(Effect.provide(h.layer()));
      const stored = yield* fs.readDirectory(`${h.home}/userdata/vet`);
      expect(stored.toSorted()).toEqual([
        "..%2F..%2Fescape%3Athread.history.jsonl",
        "..%2F..%2Fescape%3Athread.json",
      ]);
      expect(yield* fs.exists(`${h.home}/escape:thread.json`)).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("passes a goal that starts like an option as goal text", () =>
    Effect.gen(function* () {
      const h = yield* setup;
      yield* Effect.gen(function* () {
        const vet = yield* Vet.VetService;
        const started = yield* vet.run({ threadId, goal: "- Fix retries without the API" });
        expect(started.run?.goal).toBe("- Fix retries without the API");
        yield* settled;
        expect((yield* h.read("args")).split("\n")[0]).toBe("Goal: - Fix retries without the API");
      }).pipe(Effect.provide(h.layer()));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("refuses to run without the wrapper", () =>
    Effect.gen(function* () {
      const h = yield* setup;
      yield* Effect.gen(function* () {
        const vet = yield* Vet.VetService;
        const snapshot = yield* vet.get({ threadId });
        expect(snapshot.available).toBe(false);
        const error = yield* vet.run({ threadId }).pipe(Effect.flip);
        expect(error.operation).toBe("not-installed");
      }).pipe(Effect.provide(h.layer(`${h.tools}/missing.sh`)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
