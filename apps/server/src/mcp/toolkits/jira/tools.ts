import {
  JiraIssueDetail,
  JiraIssueKey,
  JiraIssueSummary,
  JiraSearchIssuesResult,
  JiraTransitionsResult,
  OrchestratorMcpFailure,
  TrimmedNonEmptyString,
  TrimmedString,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as Schema from "effect/Schema";

import * as JiraService from "../../../jira/JiraService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  JiraService.JiraService,
];

// Writes name their ticket so an approval prompt shows which one changes.
const LinkedTicketKey = Schema.optional(
  JiraIssueKey.annotate({
    description: "Ticket key such as SHP-123. Omit for the ticket this thread was started from.",
  }),
);
const RequiredTicketKey = JiraIssueKey.annotate({ description: "Ticket key such as SHP-123." });

const JiraReadTicketTool = Tool.make("t3_jira_read_ticket", {
  description:
    "Read a Jira ticket: key, summary (title), type, status, assignee, link, attachments, and its description as plain text. Omit key to read the ticket this thread was started from.",
  parameters: Schema.Struct({ key: LinkedTicketKey }),
  success: JiraIssueDetail,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read a Jira ticket")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const JiraSearchTicketsTool = Tool.make("t3_jira_search_tickets", {
  description:
    "Search Jira tickets, up to 25, most recently updated first. Pass query for a text search or a ticket key, or jql for a JQL query; pass neither to list the open tickets assigned to the connected Jira user.",
  parameters: Schema.Struct({
    query: Schema.optional(
      TrimmedString.annotate({ description: "Words to search for, or a ticket key." }),
    ),
    jql: Schema.optional(
      TrimmedNonEmptyString.annotate({
        description:
          'A JQL query, for example project = SHP AND status = "In Progress" ORDER BY updated DESC.',
      }),
    ),
  }),
  success: JiraSearchIssuesResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Search Jira tickets")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const JiraListTransitionsTool = Tool.make("t3_jira_list_transitions", {
  description:
    "List the status changes available to a Jira ticket right now: each transition's id, name, and the status it leads to. Omit key for the ticket this thread was started from. Pass an id to t3_jira_transition_ticket to move the ticket.",
  parameters: Schema.Struct({ key: LinkedTicketKey }),
  success: Schema.Struct({
    key: JiraIssueKey,
    transitions: JiraTransitionsResult.fields.transitions,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "List Jira ticket transitions")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const JiraAddCommentTool = Tool.make("t3_jira_add_comment", {
  description:
    "Post a comment on a Jira ticket as the connected Jira user. Everyone with access to the ticket sees it. text is plain text; a blank line starts a new paragraph.",
  parameters: Schema.Struct({
    key: RequiredTicketKey,
    text: TrimmedNonEmptyString.check(Schema.isMaxLength(30_000)).annotate({
      description: "The comment, as plain text.",
    }),
  }),
  success: Schema.Struct({
    key: JiraIssueKey,
    commentId: TrimmedNonEmptyString,
    url: TrimmedNonEmptyString,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Comment on a Jira ticket")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const JiraTransitionTicketTool = Tool.make("t3_jira_transition_ticket", {
  description:
    "Move a Jira ticket to another status by applying one of its transitions; get transitionId from t3_jira_list_transitions. Returns the ticket with its new status.",
  parameters: Schema.Struct({
    key: RequiredTicketKey,
    transitionId: TrimmedNonEmptyString.annotate({
      description: "A transition id from t3_jira_list_transitions.",
    }),
  }),
  success: JiraIssueSummary,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Move a Jira ticket to another status")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const JiraToolkit = Toolkit.make(
  JiraReadTicketTool,
  JiraSearchTicketsTool,
  JiraListTransitionsTool,
  JiraAddCommentTool,
  JiraTransitionTicketTool,
);
