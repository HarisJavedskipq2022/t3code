import { OrchestratorMcpFailure, type ThreadId, type VetError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as VetService from "../../../vet/VetService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readThread } from "../../threadAccess.ts";
import { VetToolkit } from "./tools.ts";

/** Vet errors carry fixed, public messages; storage causes stay on the server. */
const toFailure = (error: VetError) =>
  new OrchestratorMcpFailure({
    code:
      error.operation === "read" || error.operation === "write"
        ? "orchestration_error"
        : "invalid_request",
    message: error.message,
  });

/** The target thread, once the credential may review worktrees. */
const target = Effect.fn("VetToolkit.target")(function* (threadId: ThreadId | undefined) {
  const context = yield* McpInvocationContext.McpInvocationContext;
  if (!context.capabilities.has("worktree"))
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This credential cannot review worktrees.",
    });
  const { projection } = yield* readThread(threadId);
  return projection.thread.id;
});

const handlers = {
  t3_vet_run: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      const threadId = yield* target(input.threadId);
      const vet = yield* VetService.VetService;
      return yield* vet
        .run({
          threadId,
          ...(input.goal === undefined ? {} : { goal: input.goal }),
          ...(input.reviewer === undefined ? {} : { reviewer: input.reviewer }),
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  t3_vet_findings: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const threadId = yield* target(input.threadId);
      const vet = yield* VetService.VetService;
      const current = yield* vet.get({ threadId }).pipe(Effect.mapError(toFailure));
      if (!input.waitSeconds || current.run?.status !== "running") return current;
      const finished = yield* vet.watch({ threadId }).pipe(
        Stream.filter((snapshot) => snapshot.run?.status !== "running"),
        Stream.runHead,
        Effect.timeoutOption(`${input.waitSeconds} seconds`),
        Effect.mapError(toFailure),
      );
      return Option.getOrElse(Option.flatten(finished), () => current);
    }),
  ),
  t3_vet_update_finding: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      const threadId = yield* target(input.threadId);
      const vet = yield* VetService.VetService;
      return yield* vet
        .updateFinding({
          threadId,
          runId: input.runId,
          findingId: input.findingId,
          status: input.status,
          ...(input.note === undefined ? {} : { note: input.note }),
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof VetToolkit.tools>;

export const layer = McpToolAccess.toLayer(VetToolkit, handlers);
