import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({ app: { quit: vi.fn() } }));

import { runForkSyncScript } from "./forkSync.ts";

const writeScript = Effect.fn(function* (body: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(yield* fs.makeTempDirectoryScoped(), "fork-sync.sh");
  yield* fs.writeFileString(file, body);
  return file;
});

describe("runForkSyncScript", () => {
  it.effect("reports the script's outcome by its exit code", () =>
    Effect.gen(function* () {
      assert.equal(yield* runForkSyncScript(yield* writeScript("exit 0")), "built");
      assert.equal(yield* runForkSyncScript(yield* writeScript("exit 1")), "failed");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("joins a sync already in flight instead of starting a second one", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const runs = path.join(yield* fs.makeTempDirectoryScoped(), "runs");
      const script = yield* writeScript(`echo run >> "${runs}"`);
      // Joining is decided when the call is made, so two concurrent calls are enough.
      const results = yield* Effect.all([runForkSyncScript(script), runForkSyncScript(script)], {
        concurrency: "unbounded",
      });
      assert.deepStrictEqual(results, ["built", "built"]);
      assert.equal(yield* fs.readFileString(runs), "run\n");
      // Once it settles, the next call starts a fresh run.
      assert.equal(yield* runForkSyncScript(yield* writeScript("exit 1")), "failed");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
