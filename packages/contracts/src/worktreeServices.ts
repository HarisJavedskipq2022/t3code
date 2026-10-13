import * as Schema from "effect/Schema";
import { PortSchema, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { DiscoveredLocalServer } from "./preview.ts";

export const WorktreeServicesInput = Schema.Struct({ threadId: ThreadId });
export type WorktreeServicesInput = typeof WorktreeServicesInput.Type;
export const WorktreeServiceControlInput = Schema.Struct({
  ...WorktreeServicesInput.fields,
  scriptId: Schema.optional(TrimmedNonEmptyString),
  action: Schema.Literals(["start", "stop", "restart"]),
});
export type WorktreeServiceControlInput = typeof WorktreeServiceControlInput.Type;

export const WorktreeService = Schema.Struct({
  scriptId: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  configured: Schema.Boolean,
  status: Schema.Literals(["stopped", "starting", "running", "stopping", "failed"]),
  canStop: Schema.Boolean,
  terminal: Schema.NullOr(Schema.Struct({ threadId: ThreadId, terminalId: TrimmedNonEmptyString })),
  expectedPort: Schema.NullOr(PortSchema),
  ports: Schema.Array(PortSchema),
  urls: Schema.Array(DiscoveredLocalServer),
  exitCode: Schema.NullOr(Schema.Int),
  error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(512))),
});
export type WorktreeService = typeof WorktreeService.Type;
export const WorktreeServicesSnapshot = Schema.Struct({
  workspacePath: Schema.String,
  inspectionAvailable: Schema.Boolean,
  services: Schema.Array(WorktreeService),
});
export type WorktreeServicesSnapshot = typeof WorktreeServicesSnapshot.Type;

export class WorktreeServicesError extends Schema.TaggedError<WorktreeServicesError>()(
  "WorktreeServicesError",
  {
    operation: Schema.Literals(["read", "workspace", "invalid-request", "authorize"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    switch (this.operation) {
      case "read":
        return "Could not read worktree services.";
      case "workspace":
        return "The thread workspace is unavailable or changed. Refresh and try again.";
      case "invalid-request":
        return "This action is not an available app service.";
      case "authorize":
        return "This agent is not allowed to control app services.";
    }
  }
}
