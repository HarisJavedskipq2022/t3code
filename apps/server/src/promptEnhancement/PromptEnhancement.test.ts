import { describe, expect, it } from "@effect/vitest";
import { ProjectId, TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as PromptEnhancement from "./PromptEnhancement.ts";

const projectId = ProjectId.make("project-1");
const attachment = "[trace.har](t3-context://v1/file/trace)";

function enhance(
  rewrite: NonNullable<TextGeneration.TextGeneration["Service"]["enhancePrompt"]>,
  input: { readonly draft: string; readonly readCode: boolean },
) {
  const calls: Array<{ readonly cwd: string; readonly readCode: boolean }> = [];
  const layer = PromptEnhancement.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: () =>
            Effect.succeedSome({
              projectId,
              title: "Ship Nest",
              workspaceRoot: "/repo",
              defaultModelSelection: null,
              defaultThreadEnvMode: null,
              autoPull: false,
              faviconPath: null,
              projectIcon: null,
              scripts: [],
              createdAt: "2026-10-28T00:00:00.000Z",
              updatedAt: "2026-10-28T00:00:00.000Z",
              deletedAt: null,
            }),
        }),
        ServerSettings.layerTest().pipe(Layer.orDie),
        Layer.mock(TextGeneration.TextGeneration)({
          enhancePrompt: (request) => {
            calls.push({ cwd: request.cwd, readCode: request.readCode });
            return rewrite(request);
          },
        }),
      ),
    ),
  );
  return {
    calls,
    run: Effect.flatMap(PromptEnhancement.PromptEnhancement, (service) =>
      service.enhance({ projectId, ...input }),
    ).pipe(Effect.provide(layer)),
  };
}

describe("PromptEnhancement", () => {
  it.effect("rewrites in the project's checkout and says whether it read the code", () =>
    Effect.gen(function* () {
      const test = enhance(() => Effect.succeed({ prompt: "Fix the card", readCode: false }), {
        draft: "fix card",
        readCode: true,
      });
      expect(yield* test.run).toEqual({ prompt: "Fix the card", readCode: false });
      expect(test.calls).toEqual([{ cwd: "/repo", readCode: true }]);
    }),
  );

  it.effect("fails when the provider cannot rewrite, takes too long, or drops an attachment", () =>
    Effect.gen(function* () {
      const unsupported = yield* Effect.flip(
        enhance(
          () =>
            Effect.fail(
              new TextGenerationError({
                operation: "enhancePrompt",
                detail: "This provider does not rewrite prompts.",
              }),
            ),
          { draft: "fix card", readCode: false },
        ).run,
      );
      expect(unsupported.detail).toBe(
        "Could not enhance the prompt: This provider does not rewrite prompts.",
      );

      const dropped = yield* Effect.flip(
        enhance(() => Effect.succeed({ prompt: "Fix the card", readCode: false }), {
          draft: `fix card, see ${attachment}`,
          readCode: false,
        }).run,
      );
      expect(dropped.detail).toBe(
        "Could not enhance the prompt: the rewrite dropped an attachment.",
      );

      const slow = yield* Effect.forkChild(
        Effect.flip(enhance(() => Effect.never, { draft: "fix card", readCode: true }).run),
      );
      yield* TestClock.adjust("150 seconds");
      expect((yield* Fiber.join(slow)).detail).toBe(
        "Could not enhance the prompt: the model took too long.",
      );
    }),
  );
});
