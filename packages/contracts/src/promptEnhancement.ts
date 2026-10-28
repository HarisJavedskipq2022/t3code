import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** The project's checkout is where the model reads the code, read-only. */
export const PromptEnhanceInput = Schema.Struct({
  projectId: ProjectId,
  draft: TrimmedNonEmptyString,
  readCode: Schema.Boolean,
});
export type PromptEnhanceInput = typeof PromptEnhanceInput.Type;

export const PromptEnhanceResult = Schema.Struct({
  prompt: TrimmedNonEmptyString,
  /** False when the provider could not read the code and rewrote from the draft alone. */
  readCode: Schema.Boolean,
});
export type PromptEnhanceResult = typeof PromptEnhanceResult.Type;

export class PromptEnhanceError extends Schema.TaggedError<PromptEnhanceError>()(
  "PromptEnhanceError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
