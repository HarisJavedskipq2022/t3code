import {
  OrchestratorMcpFailure,
  ThreadId,
  VetFindingStatus,
  VetReviewer,
  VetRunInput,
  VetSnapshot,
  VetUpdateFindingInput,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as Schema from "effect/Schema";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as VetService from "../../../vet/VetService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  VetService.VetService,
];

const VetRunTool = Tool.make("t3_vet_run", {
  description:
    "Start a vet review of a thread's change (omit threadId for this thread): a different model judges the branch diff, uncommitted edits included, against the goal and the thread's conversation. Reviews take 5 to 15 minutes and run in the background, one per thread; read the result with t3_vet_findings. goal defaults to the thread's first message; state what the change must and must not do when that message does not. reviewer defaults to codex; pass claude when Codex wrote the code.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    goal: VetRunInput.fields.goal,
    reviewer: Schema.optional(VetReviewer),
  }),
  success: VetSnapshot,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Start a vet review")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const VetFindingsTool = Tool.make("t3_vet_findings", {
  description:
    "Read a thread's latest vet review (omit threadId for this thread): its status, goal, and findings with severity (1 to 5), confidence, file, line, and the user's verdict on each. Pass waitSeconds to wait up to that long for a running review to finish. The reviewer is a judge, not ground truth: read the cited code and confirm or refute each finding before acting on it, then record the verdict with t3_vet_update_finding.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    waitSeconds: Schema.optional(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(600)),
    ),
  }),
  success: VetSnapshot,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read vet findings")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const VetUpdateFindingTool = Tool.make("t3_vet_update_finding", {
  description:
    "Record a verdict on one finding of a thread's latest vet review (omit threadId for this thread): confirmed after you verified it against the code, dismissed with a note saying why it is wrong, or open to undo either. The user sees these verdicts in the Vet panel.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    runId: VetUpdateFindingInput.fields.runId,
    findingId: VetUpdateFindingInput.fields.findingId,
    status: VetFindingStatus,
    note: VetUpdateFindingInput.fields.note,
  }),
  success: VetSnapshot,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Record a vet verdict")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const VetToolkit = Toolkit.make(VetRunTool, VetFindingsTool, VetUpdateFindingTool);
