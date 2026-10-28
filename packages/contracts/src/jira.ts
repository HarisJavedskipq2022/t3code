import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

const emptyByDefault = TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed("")));

/**
 * One Jira Cloud site per environment. An empty transition name turns that
 * automatic move off; transitions are matched by their target status name,
 * because workflow transition ids differ between projects.
 */
export const JiraSettings = Schema.Struct({
  siteUrl: emptyByDefault,
  email: emptyByDefault,
  apiToken: emptyByDefault.annotateKey({ settingsSecret: true }),
  commentOnPullRequest: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  openedTransition: emptyByDefault,
  mergedTransition: emptyByDefault,
});
export type JiraSettings = typeof JiraSettings.Type;

export const JiraSettingsPatch = Schema.Struct({
  siteUrl: Schema.optionalKey(TrimmedString),
  email: Schema.optionalKey(TrimmedString),
  apiToken: Schema.optionalKey(TrimmedString),
  commentOnPullRequest: Schema.optionalKey(Schema.Boolean),
  openedTransition: Schema.optionalKey(TrimmedString),
  mergedTransition: Schema.optionalKey(TrimmedString),
});
export type JiraSettingsPatch = typeof JiraSettingsPatch.Type;

export const JiraIssueKey = TrimmedNonEmptyString.check(Schema.isPattern(/^[A-Z][A-Z0-9_]+-\d+$/));
export type JiraIssueKey = typeof JiraIssueKey.Type;

/** The ticket a thread works on. Kept small: the thread shows it, the server updates it. */
export const ThreadLinkedTicket = Schema.Struct({
  provider: Schema.Literal("jira"),
  key: JiraIssueKey,
  url: TrimmedNonEmptyString,
  title: Schema.optional(TrimmedString),
  isBug: Schema.optional(Schema.Boolean),
});
export type ThreadLinkedTicket = typeof ThreadLinkedTicket.Type;

export const JiraIssueStatusCategory = Schema.Literals(["new", "indeterminate", "done", "unknown"]);
export type JiraIssueStatusCategory = typeof JiraIssueStatusCategory.Type;

export const JiraIssueSummary = Schema.Struct({
  key: JiraIssueKey,
  url: TrimmedNonEmptyString,
  title: TrimmedString,
  issueType: TrimmedString,
  isBug: Schema.Boolean,
  status: TrimmedString,
  statusCategory: JiraIssueStatusCategory,
  /** Display name; absent when the issue is unassigned. */
  assignee: Schema.optional(TrimmedString),
});
export type JiraIssueSummary = typeof JiraIssueSummary.Type;

export const JiraIssueAttachment = Schema.Struct({
  filename: TrimmedString,
  url: TrimmedNonEmptyString,
});
export type JiraIssueAttachment = typeof JiraIssueAttachment.Type;

export const JiraIssueComment = Schema.Struct({
  author: TrimmedString,
  /** ISO timestamp, as Jira sends it. */
  created: TrimmedString,
  body: Schema.String,
});
export type JiraIssueComment = typeof JiraIssueComment.Type;

export const JiraIssueDetail = Schema.Struct({
  ...JiraIssueSummary.fields,
  /** Plain text converted from Jira's document format. */
  description: Schema.String,
  /** From custom fields named like "Acceptance criteria"; empty when the site has none. */
  acceptanceCriteria: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  /** The latest comments, oldest first. */
  comments: Schema.Array(JiraIssueComment).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  attachments: Schema.Array(JiraIssueAttachment),
});
export type JiraIssueDetail = typeof JiraIssueDetail.Type;

export const JiraTransition = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedString,
  toStatus: TrimmedString,
});
export type JiraTransition = typeof JiraTransition.Type;

/** Empty `query` lists the open issues assigned to the signed-in user. */
export const JiraSearchIssuesInput = Schema.Struct({ query: TrimmedString });
export type JiraSearchIssuesInput = typeof JiraSearchIssuesInput.Type;

export const JiraSearchIssuesResult = Schema.Struct({ issues: Schema.Array(JiraIssueSummary) });
export type JiraSearchIssuesResult = typeof JiraSearchIssuesResult.Type;

export const JiraIssueInput = Schema.Struct({ key: JiraIssueKey });
export type JiraIssueInput = typeof JiraIssueInput.Type;

export const JiraTransitionsResult = Schema.Struct({ transitions: Schema.Array(JiraTransition) });
export type JiraTransitionsResult = typeof JiraTransitionsResult.Type;

export const JiraTransitionIssueInput = Schema.Struct({
  key: JiraIssueKey,
  transitionId: TrimmedNonEmptyString,
});
export type JiraTransitionIssueInput = typeof JiraTransitionIssueInput.Type;

/** The project's checkout is where the model reads the ticket, like a thread title. */
export const JiraEnhanceTicketPromptInput = Schema.Struct({
  key: JiraIssueKey,
  projectId: ProjectId,
});
export type JiraEnhanceTicketPromptInput = typeof JiraEnhanceTicketPromptInput.Type;

export const JiraEnhanceTicketPromptResult = Schema.Struct({ prompt: TrimmedNonEmptyString });
export type JiraEnhanceTicketPromptResult = typeof JiraEnhanceTicketPromptResult.Type;

export const JiraConnectionResult = Schema.Struct({ displayName: TrimmedString });
export type JiraConnectionResult = typeof JiraConnectionResult.Type;

export class JiraError extends Schema.TaggedError<JiraError>()("JiraError", {
  reason: Schema.Literals(["notConfigured", "unauthorized", "notFound", "request"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
