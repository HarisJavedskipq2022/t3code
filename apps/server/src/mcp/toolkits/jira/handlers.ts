import { type JiraError, type JiraIssueKey, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as JiraService from "../../../jira/JiraService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller } from "../../threadAccess.ts";
import { JiraToolkit } from "./tools.ts";

/** Jira errors carry fixed messages that never quote the login or the request. */
const toFailure = (error: JiraError) =>
  new OrchestratorMcpFailure({
    code: error.reason === "request" ? "orchestration_error" : "invalid_request",
    message:
      error.reason === "notConfigured"
        ? "Jira is not connected on this T3 Code environment. Ask the user to connect it in Settings → Integrations."
        : error.message,
  });

// Ticket work travels with pull requests, so it shares that grant.
const jira = Effect.fn("JiraToolkit.jira")(function* () {
  const context = yield* McpInvocationContext.McpInvocationContext;
  if (!context.capabilities.has("pull-requests"))
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This credential cannot use Jira.",
    });
  return yield* JiraService.JiraService;
});

const ticketKey = Effect.fn("JiraToolkit.ticketKey")(function* (key: JiraIssueKey | undefined) {
  if (key !== undefined) return key;
  const { caller } = yield* loadCaller();
  const linked = caller?.linkedTicket?.key;
  if (linked !== undefined) return linked;
  return yield* new OrchestratorMcpFailure({
    code: "target_required",
    message:
      caller === undefined
        ? "Pass key: this MCP client is not running inside a T3 thread."
        : "Pass key: this thread was not started from a Jira ticket.",
  });
});

const handlers = {
  t3_jira_read_ticket: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const service = yield* jira();
      const key = yield* ticketKey(input.key);
      return yield* service.getIssue({ key }).pipe(Effect.mapError(toFailure));
    }),
  ),
  t3_jira_search_tickets: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const service = yield* jira();
      if (input.jql !== undefined && input.query) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Pass query or jql, not both.",
        });
      }
      const search =
        input.jql === undefined
          ? service.searchIssues({ query: input.query ?? "" })
          : service.searchJql({ jql: input.jql });
      return yield* search.pipe(Effect.mapError(toFailure));
    }),
  ),
  t3_jira_list_transitions: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const service = yield* jira();
      const key = yield* ticketKey(input.key);
      const { transitions } = yield* service
        .listTransitions({ key })
        .pipe(Effect.mapError(toFailure));
      return { key, transitions };
    }),
  ),
  t3_jira_add_comment: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      const service = yield* jira();
      return yield* service
        .addComment({ key: input.key, text: input.text })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  t3_jira_transition_ticket: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      const service = yield* jira();
      return yield* service
        .transitionIssue({ key: input.key, transitionId: input.transitionId })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof JiraToolkit.tools>;

export const layer = McpToolAccess.toLayer(JiraToolkit, handlers);
