import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Who judges the change: GPT through Codex (default), vet on Claude, or Grok through Cursor. */
export const VetReviewer = Schema.Literals(["codex", "claude", "grok"]);
export type VetReviewer = typeof VetReviewer.Type;

/** A user's verdict on one finding. Every status can be set back to `open`. */
export const VetFindingStatus = Schema.Literals(["open", "confirmed", "dismissed"]);
export type VetFindingStatus = typeof VetFindingStatus.Type;

export const VetFinding = Schema.Struct({
  id: TrimmedNonEmptyString,
  issueCode: Schema.String,
  /** 1 (nit) to 5 (critical), as the reviewer scored it. */
  severity: Schema.Int,
  confidence: Schema.Number,
  /** Relative to the repository root. */
  filePath: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Int),
  description: Schema.String,
  status: VetFindingStatus,
  /** Why it was dismissed, when someone said. */
  note: Schema.NullOr(Schema.String),
});
export type VetFinding = typeof VetFinding.Type;

export const VetRunStatus = Schema.Literals(["running", "clean", "issues", "failed", "cancelled"]);
export type VetRunStatus = typeof VetRunStatus.Type;

export const VetRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  reviewer: VetReviewer,
  goal: Schema.String,
  status: VetRunStatus,
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
  /** Why a run failed, from the end of the wrapper's output. */
  error: Schema.NullOr(Schema.String),
  findings: Schema.Array(VetFinding),
  /** Findings the reviewer reported under the confidence threshold, when it counts them. */
  belowThreshold: Schema.NullOr(NonNegativeInt),
});
export type VetRun = typeof VetRun.Type;

export const VetSnapshot = Schema.Struct({
  threadId: ThreadId,
  /** The vet wrapper this environment runs. */
  scriptPath: Schema.String,
  available: Schema.Boolean,
  /** The thread's latest run; earlier runs are replaced. */
  run: Schema.NullOr(VetRun),
});
export type VetSnapshot = typeof VetSnapshot.Type;

export const VetThreadInput = Schema.Struct({ threadId: ThreadId });
export type VetThreadInput = typeof VetThreadInput.Type;

export const VetRunInput = Schema.Struct({
  threadId: ThreadId,
  /** What the change must and must not do. Defaults to the thread's first message. */
  goal: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(8_000))),
  reviewer: Schema.optional(VetReviewer),
});
export type VetRunInput = typeof VetRunInput.Type;

export const VetUpdateFindingInput = Schema.Struct({
  threadId: ThreadId,
  runId: TrimmedNonEmptyString,
  findingId: TrimmedNonEmptyString,
  status: VetFindingStatus,
  note: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
});
export type VetUpdateFindingInput = typeof VetUpdateFindingInput.Type;

export class VetError extends Schema.TaggedError<VetError>()("VetError", {
  operation: Schema.Literals(["read", "workspace", "not-installed", "busy", "not-found", "write"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    switch (this.operation) {
      case "read":
        return "Could not read the vet review.";
      case "workspace":
        return "The thread's workspace is unavailable.";
      case "not-installed":
        return "The vet wrapper is not installed on this environment.";
      case "busy":
        return "A vet review is already running for this thread.";
      case "not-found":
        return "That vet finding no longer exists. A newer review may have replaced it.";
      case "write":
        return "Could not save the vet review.";
    }
  }
}
