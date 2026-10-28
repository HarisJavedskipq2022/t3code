import {
  JiraError,
  type JiraIssueComment,
  type JiraIssueDetail,
  type JiraIssueStatusCategory,
  type JiraIssueSummary,
  type JiraTransition,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { jiraCommentDocument, jiraDocumentToText, jiraTextDocument } from "./jiraDocument.ts";

export interface JiraCredentials {
  readonly siteUrl: string;
  readonly email: string;
  readonly apiToken: string;
}

const REQUEST_TIMEOUT = "20 seconds";
const SEARCH_LIMIT = 25;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const SUMMARY_FIELDS = ["summary", "status", "issuetype", "assignee"];
const ERROR_DETAIL_LIMIT = 500;
const COMMENT_LIMIT = 5;
const COMMENT_LENGTH = 1_500;
const ACCEPTANCE_CRITERIA_FIELD = /acceptance criteria|definition of done/i;

const OptionalName = Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String) }));

const IssueFields = Schema.Struct({
  summary: Schema.optional(Schema.String),
  status: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      statusCategory: Schema.optional(Schema.Struct({ key: Schema.optional(Schema.String) })),
    }),
  ),
  issuetype: OptionalName,
  assignee: Schema.optional(
    Schema.NullOr(Schema.Struct({ displayName: Schema.optional(Schema.String) })),
  ),
  description: Schema.optional(Schema.Unknown),
  attachment: Schema.optional(
    Schema.Array(
      Schema.Struct({
        filename: Schema.optional(Schema.String),
        content: Schema.optional(Schema.String),
      }),
    ),
  ),
  comment: Schema.optional(
    Schema.Struct({
      comments: Schema.optional(
        Schema.Array(
          Schema.Struct({
            author: Schema.optional(Schema.Struct({ displayName: Schema.optional(Schema.String) })),
            created: Schema.optional(Schema.String),
            body: Schema.optional(Schema.Unknown),
          }),
        ),
      ),
    }),
  ),
});

const Issue = Schema.Struct({ key: Schema.String, fields: IssueFields });
type Issue = typeof Issue.Type;

// Acceptance criteria live in a custom field whose id differs per site, so `names` finds it.
const DetailIssue = Schema.Struct({
  key: Schema.String,
  fields: Schema.StructWithRest(IssueFields, [Schema.Record(Schema.String, Schema.Unknown)]),
  names: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
type DetailIssue = typeof DetailIssue.Type;

const SearchResponse = Schema.Struct({ issues: Schema.Array(Issue) });
const TransitionsResponse = Schema.Struct({
  transitions: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.String), to: OptionalName }),
  ),
});
const MyselfResponse = Schema.Struct({ displayName: Schema.optional(Schema.String) });
const CommentsResponse = Schema.Struct({
  comments: Schema.Array(Schema.Struct({ body: Schema.optional(Schema.Unknown) })),
});
const CreatedComment = Schema.Struct({ id: Schema.String });
const ErrorResponse = Schema.Struct({
  errorMessages: Schema.optional(Schema.Array(Schema.String)),
  errors: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const decodeErrorResponse = Schema.decodeUnknownOption(ErrorResponse);

/** Accepts `team.atlassian.net`, a full URL, or a pasted issue link. */
export function normalizeJiraSiteUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === "https:" || url.hostname === "localhost" ? url.origin : null;
  } catch {
    return null;
  }
}

export function jiraIssueKeyOf(query: string): string | null {
  const key = query.trim().toUpperCase();
  return ISSUE_KEY.test(key) ? key : null;
}

/** JQL string literal: quotes and backslashes escaped, reserved characters kept inside. */
function jqlString(value: string): string {
  return `"${value.replace(/["\\]/g, (character) => `\\${character}`)}"`;
}

export function jiraSearchJql(query: string): string {
  const text = query.trim();
  return text.length === 0
    ? "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
    : `text ~ ${jqlString(text)} ORDER BY updated DESC`;
}

function statusCategoryOf(key: string | undefined): JiraIssueStatusCategory {
  return key === "new" || key === "indeterminate" || key === "done" ? key : "unknown";
}

function issueSummary(siteUrl: string, issue: Issue): JiraIssueSummary {
  const issueType = issue.fields.issuetype?.name ?? "";
  const assignee = issue.fields.assignee?.displayName?.trim();
  return {
    key: issue.key,
    url: `${siteUrl}/browse/${issue.key}`,
    title: issue.fields.summary?.trim() ?? "",
    issueType,
    isBug: /bug|defect/i.test(issueType),
    status: issue.fields.status?.name ?? "",
    statusCategory: statusCategoryOf(issue.fields.status?.statusCategory?.key),
    ...(assignee ? { assignee } : {}),
  };
}

function acceptanceCriteriaOf(issue: DetailIssue): string {
  return Object.entries(issue.names ?? {})
    .filter(([id, name]) => id.startsWith("customfield_") && ACCEPTANCE_CRITERIA_FIELD.test(name))
    .map(([id]) => jiraDocumentToText(issue.fields[id] ?? ""))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function commentsOf(issue: DetailIssue): ReadonlyArray<JiraIssueComment> {
  return (issue.fields.comment?.comments ?? [])
    .flatMap((comment) => {
      const body = jiraDocumentToText(comment.body ?? "");
      if (body.length === 0) return [];
      return [
        {
          author: comment.author?.displayName?.trim() ?? "",
          created: comment.created?.trim() ?? "",
          body: body.length > COMMENT_LENGTH ? `${body.slice(0, COMMENT_LENGTH).trimEnd()}…` : body,
        },
      ];
    })
    .slice(-COMMENT_LIMIT);
}

function issueDetail(siteUrl: string, issue: DetailIssue): JiraIssueDetail {
  return {
    ...issueSummary(siteUrl, issue),
    description: jiraDocumentToText(issue.fields.description ?? ""),
    acceptanceCriteria: acceptanceCriteriaOf(issue),
    comments: commentsOf(issue),
    attachments: (issue.fields.attachment ?? []).flatMap((attachment) =>
      attachment.content ? [{ filename: attachment.filename ?? "", url: attachment.content }] : [],
    ),
  };
}

/**
 * Jira explains a rejected request (bad JQL, an unavailable transition) in its body.
 * Those messages name fields and values, never the login.
 */
function rejectedDetail(body: unknown): string | null {
  const decoded = decodeErrorResponse(body);
  if (decoded._tag === "None") return null;
  const messages = [
    ...(decoded.value.errorMessages ?? []),
    ...Object.values(decoded.value.errors ?? {}),
  ].filter((message) => message.trim().length > 0);
  return messages.length === 0 ? null : messages.join(" ").slice(0, ERROR_DETAIL_LIMIT);
}

function statusError(status: number, body: unknown): JiraError {
  if (status === 401 || status === 403) {
    return new JiraError({
      reason: "unauthorized",
      detail: "Jira rejected the login. Check the email and API token in Settings → Integrations.",
    });
  }
  if (status === 404) {
    return new JiraError({ reason: "notFound", detail: "Jira could not find that issue." });
  }
  const rejected = status === 400 ? rejectedDetail(body) : null;
  return new JiraError({
    reason: "request",
    detail: rejected === null ? `Jira answered with HTTP ${status}.` : `Jira: ${rejected}`,
  });
}

// No cause on purpose: transport errors can quote the request, and its Authorization header.
const requestFailed = () =>
  new JiraError({ reason: "request", detail: "Could not reach Jira. Check the site URL." });

export const makeJiraApi = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;

  const send = Effect.fn("JiraApi.send")(function* <E>(
    credentials: JiraCredentials,
    build: (siteUrl: string) => Effect.Effect<HttpClientRequest.HttpClientRequest, E>,
  ) {
    const siteUrl = normalizeJiraSiteUrl(credentials.siteUrl);
    if (siteUrl === null || !credentials.email || !credentials.apiToken) {
      return yield* new JiraError({
        reason: "notConfigured",
        detail: "Connect Jira in Settings → Integrations first.",
      });
    }
    const request = yield* build(siteUrl).pipe(Effect.mapError(requestFailed));
    const response = yield* httpClient
      .execute(
        request.pipe(
          HttpClientRequest.basicAuth(credentials.email, credentials.apiToken),
          HttpClientRequest.acceptJson,
        ),
      )
      .pipe(Effect.timeout(REQUEST_TIMEOUT), Effect.mapError(requestFailed));
    if (response.status < 200 || response.status >= 300) {
      const body =
        response.status === 400
          ? yield* response.json.pipe(Effect.orElseSucceed(() => null))
          : null;
      return yield* statusError(response.status, body);
    }
    return { siteUrl, response };
  });

  const sendJson = <S extends Schema.Top, E>(
    credentials: JiraCredentials,
    schema: S,
    build: (siteUrl: string) => Effect.Effect<HttpClientRequest.HttpClientRequest, E>,
  ) =>
    send(credentials, build).pipe(
      Effect.flatMap(({ siteUrl, response }) =>
        HttpClientResponse.schemaBodyJson(schema)(response).pipe(
          Effect.map((body) => ({ siteUrl, body })),
          Effect.mapError(
            () =>
              new JiraError({ reason: "request", detail: "Jira sent a response T3 can't read." }),
          ),
        ),
      ),
    );

  const get = (path: string) => (siteUrl: string) =>
    Effect.succeed(HttpClientRequest.get(`${siteUrl}${path}`));
  const post = (path: string, body: unknown) => (siteUrl: string) =>
    HttpClientRequest.post(`${siteUrl}${path}`).pipe(HttpClientRequest.bodyJson(body));
  const issuePath = (key: string) => `/rest/api/3/issue/${encodeURIComponent(key)}`;

  const getIssue = (credentials: JiraCredentials, key: string) =>
    sendJson(credentials, DetailIssue, get(`${issuePath(key)}?fields=*all&expand=names`)).pipe(
      Effect.map(({ siteUrl, body }) => issueDetail(siteUrl, body)),
    );

  const getIssueSummary = (credentials: JiraCredentials, key: string) =>
    sendJson(credentials, Issue, get(`${issuePath(key)}?fields=${SUMMARY_FIELDS.join(",")}`)).pipe(
      Effect.map(({ siteUrl, body }) => issueSummary(siteUrl, body)),
    );

  const searchJql = (credentials: JiraCredentials, jql: string) =>
    sendJson(
      credentials,
      SearchResponse,
      post("/rest/api/3/search/jql", { jql, fields: SUMMARY_FIELDS, maxResults: SEARCH_LIMIT }),
    ).pipe(
      Effect.map(({ siteUrl, body }) => body.issues.map((issue) => issueSummary(siteUrl, issue))),
    );

  const searchIssues = (credentials: JiraCredentials, query: string) => {
    const key = jiraIssueKeyOf(query);
    // A key goes straight to the issue: JQL rejects a `key =` clause naming a missing issue.
    if (key !== null) {
      return getIssueSummary(credentials, key).pipe(
        Effect.map((summary) => [summary]),
        Effect.catchIf(
          (error) => error.reason === "notFound",
          () => Effect.succeed([]),
        ),
      );
    }
    return searchJql(credentials, jiraSearchJql(query));
  };

  const listTransitions = (credentials: JiraCredentials, key: string) =>
    sendJson(credentials, TransitionsResponse, get(`${issuePath(key)}/transitions`)).pipe(
      Effect.map(({ body }): ReadonlyArray<JiraTransition> =>
        body.transitions.map((transition) => ({
          id: transition.id,
          name: transition.name ?? "",
          toStatus: transition.to?.name ?? transition.name ?? "",
        })),
      ),
    );

  const transitionIssue = (credentials: JiraCredentials, key: string, transitionId: string) =>
    send(credentials, post(`${issuePath(key)}/transitions`, { transition: { id: transitionId } }));

  const myself = (credentials: JiraCredentials) =>
    sendJson(credentials, MyselfResponse, get("/rest/api/3/myself")).pipe(
      Effect.map(({ body }) => ({ displayName: body.displayName ?? credentials.email })),
    );

  /** Comments once: a retried effect finds its earlier comment by the link it carries. */
  const commentOnce = (credentials: JiraCredentials, key: string, text: string, url: string) =>
    sendJson(credentials, CommentsResponse, get(`${issuePath(key)}/comment?maxResults=100`)).pipe(
      Effect.flatMap(({ body }) =>
        body.comments.some((comment) => JSON.stringify(comment.body ?? "").includes(url))
          ? Effect.void
          : send(
              credentials,
              post(`${issuePath(key)}/comment`, { body: jiraCommentDocument(text, url) }),
            ).pipe(Effect.asVoid),
      ),
    );

  const comment = (credentials: JiraCredentials, key: string, text: string) =>
    sendJson(
      credentials,
      CreatedComment,
      post(`${issuePath(key)}/comment`, { body: jiraTextDocument(text) }),
    ).pipe(
      Effect.map(({ siteUrl, body }) => ({
        key,
        commentId: body.id,
        url: `${siteUrl}/browse/${key}?focusedCommentId=${encodeURIComponent(body.id)}`,
      })),
    );

  return {
    getIssue,
    getIssueSummary,
    searchIssues,
    searchJql,
    listTransitions,
    transitionIssue,
    myself,
    comment,
    commentOnce,
  };
});

export type JiraApi = Effect.Success<typeof makeJiraApi>;

/** Matches the configured status by its name, the way Jira shows it, ignoring case. */
export function findTransitionTo(
  transitions: ReadonlyArray<JiraTransition>,
  statusName: string,
): JiraTransition | null {
  const wanted = statusName.trim().toLowerCase();
  if (wanted.length === 0) return null;
  return (
    transitions.find((transition) => transition.toStatus.toLowerCase() === wanted) ??
    transitions.find((transition) => transition.name.toLowerCase() === wanted) ??
    null
  );
}
