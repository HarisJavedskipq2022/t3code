import {
  PromptEnhanceError,
  type PromptEnhanceInput,
  type PromptEnhanceResult,
} from "@t3tools/contracts";
import { keepsContextLinks } from "@t3tools/provider-core/server/promptEnhancement";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

// Reading code takes several model turns; a plain rewrite is one call. Past these the draft stands.
const REWRITE_TIMEOUT = "60 seconds";
const READ_CODE_TIMEOUT = "150 seconds";

export class PromptEnhancement extends Context.Service<
  PromptEnhancement,
  {
    /** Rewrites a draft into a structured agent prompt with the project's text model. */
    readonly enhance: (
      input: PromptEnhanceInput,
    ) => Effect.Effect<PromptEnhanceResult, PromptEnhanceError>;
  }
>()("t3/promptEnhancement/PromptEnhancement") {}

const isPromptEnhanceError = Schema.is(PromptEnhanceError);
const failed = (detail: string) =>
  new PromptEnhanceError({ detail: `Could not enhance the prompt: ${detail}` });

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;

  const enhance = Effect.fn("PromptEnhancement.enhance")(function* (input: PromptEnhanceInput) {
    const project = yield* projects
      .get(input.projectId)
      .pipe(Effect.mapError(() => failed("the project could not be read.")));
    if (Option.isNone(project)) return yield* failed("the project no longer exists.");
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(() => failed("the settings could not be read.")),
    );
    const rewrite = textGeneration.enhancePrompt;
    if (rewrite === undefined) return yield* failed("text generation is unavailable.");
    const result = yield* rewrite({
      cwd: project.value.workspaceRoot,
      draft: input.draft,
      readCode: input.readCode,
      modelSelection: resolveProjectSettings(settings, input.projectId).settings
        .textGenerationModelSelection,
    }).pipe(
      Effect.timeoutOrElse({
        duration: input.readCode ? READ_CODE_TIMEOUT : REWRITE_TIMEOUT,
        orElse: () => Effect.fail(failed("the model took too long.")),
      }),
      Effect.tapError((error) =>
        Effect.logWarning("Prompt enhancement failed", { readCode: input.readCode, error }),
      ),
      Effect.mapError((error) => (isPromptEnhanceError(error) ? error : failed(error.detail))),
    );
    if (result.prompt.length === 0) return yield* failed("the model returned nothing.");
    if (!keepsContextLinks(input.draft, result.prompt)) {
      return yield* failed("the rewrite dropped an attachment.");
    }
    return { prompt: result.prompt, readCode: result.readCode };
  });

  return PromptEnhancement.of({ enhance });
});

export const layer = Layer.effect(PromptEnhancement, make);
