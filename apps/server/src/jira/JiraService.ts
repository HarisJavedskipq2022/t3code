import {
  JiraError,
  type JiraConnectionResult,
  type JiraIssueDetail,
  type JiraIssueInput,
  type JiraIssueSummary,
  type JiraSearchIssuesInput,
  type JiraSearchIssuesResult,
  type JiraTransitionIssueInput,
  type JiraTransitionsResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Settings from "../serverSettings.ts";
import { findTransitionTo, type JiraCredentials, makeJiraApi } from "./jiraApi.ts";

export type JiraPullRequestStage = "opened" | "merged";

export interface JiraComment {
  readonly key: string;
  readonly commentId: string;
  readonly url: string;
}

export class JiraService extends Context.Service<
  JiraService,
  {
    readonly searchIssues: (
      input: JiraSearchIssuesInput,
    ) => Effect.Effect<JiraSearchIssuesResult, JiraError>;
    /** Raw JQL, for callers that write their own queries; `searchIssues` takes text or a key. */
    readonly searchJql: (input: {
      readonly jql: string;
    }) => Effect.Effect<JiraSearchIssuesResult, JiraError>;
    readonly getIssue: (input: JiraIssueInput) => Effect.Effect<JiraIssueDetail, JiraError>;
    /** Plain text; blank lines start new paragraphs. */
    readonly addComment: (input: {
      readonly key: string;
      readonly text: string;
    }) => Effect.Effect<JiraComment, JiraError>;
    readonly listTransitions: (
      input: JiraIssueInput,
    ) => Effect.Effect<JiraTransitionsResult, JiraError>;
    readonly transitionIssue: (
      input: JiraTransitionIssueInput,
    ) => Effect.Effect<JiraIssueSummary, JiraError>;
    readonly testConnection: Effect.Effect<JiraConnectionResult, JiraError>;
    /**
     * Brings a ticket in line with its thread's pull request: comments the link
     * when it opens and moves the ticket to the status configured for the stage.
     * Safe to repeat, since the outbox retries it.
     */
    readonly applyPullRequestStage: (input: {
      readonly key: string;
      readonly pullRequestUrl: string;
      readonly stage: JiraPullRequestStage;
    }) => Effect.Effect<void, JiraError>;
  }
>()("t3/jira/JiraService") {}

const make = Effect.gen(function* () {
  const settingsService = yield* Settings.ServerSettingsService;
  const api = yield* makeJiraApi;

  const settings = settingsService.getSettings.pipe(
    Effect.map((current) => current.jira),
    Effect.mapError(
      () => new JiraError({ reason: "request", detail: "Could not read the Jira settings." }),
    ),
  );
  const credentials: Effect.Effect<JiraCredentials, JiraError> = settings;

  const searchIssues: JiraService["Service"]["searchIssues"] = (input) =>
    credentials.pipe(
      Effect.flatMap((login) => api.searchIssues(login, input.query)),
      Effect.map((issues) => ({ issues })),
    );

  const searchJql = Effect.fn("JiraService.searchJql")(function* (input: { readonly jql: string }) {
    const login = yield* credentials;
    return { issues: yield* api.searchJql(login, input.jql) };
  });

  const addComment = Effect.fn("JiraService.addComment")(function* (input: {
    readonly key: string;
    readonly text: string;
  }) {
    const login = yield* credentials;
    return yield* api.comment(login, input.key, input.text);
  });

  const getIssue: JiraService["Service"]["getIssue"] = (input) =>
    credentials.pipe(Effect.flatMap((login) => api.getIssue(login, input.key)));

  const listTransitions: JiraService["Service"]["listTransitions"] = (input) =>
    credentials.pipe(
      Effect.flatMap((login) => api.listTransitions(login, input.key)),
      Effect.map((transitions) => ({ transitions })),
    );

  const transitionIssue = Effect.fn("JiraService.transitionIssue")(function* (
    input: JiraTransitionIssueInput,
  ) {
    const login = yield* credentials;
    yield* api.transitionIssue(login, input.key, input.transitionId);
    return yield* api.getIssueSummary(login, input.key);
  });

  const testConnection = credentials.pipe(Effect.flatMap(api.myself));

  const applyPullRequestStage = Effect.fn("JiraService.applyPullRequestStage")(function* (
    input: Parameters<JiraService["Service"]["applyPullRequestStage"]>[0],
  ) {
    const jira = yield* settings;
    if (!jira.siteUrl || !jira.email || !jira.apiToken) return;
    if (input.stage === "opened" && jira.commentOnPullRequest) {
      yield* api.commentOnce(jira, input.key, "Pull request opened:", input.pullRequestUrl);
    }
    const target = input.stage === "opened" ? jira.openedTransition : jira.mergedTransition;
    if (!target) return;
    const issue = yield* api.getIssueSummary(jira, input.key);
    if (issue.status.toLowerCase() === target.toLowerCase()) return;
    const transition = findTransitionTo(yield* api.listTransitions(jira, input.key), target);
    if (transition === null) {
      yield* Effect.logWarning("Jira has no transition to the configured status", {
        stage: input.stage,
        status: target,
      });
      return;
    }
    yield* api.transitionIssue(jira, input.key, transition.id);
  });

  return JiraService.of({
    searchIssues,
    searchJql,
    getIssue,
    addComment,
    listTransitions,
    transitionIssue,
    testConnection,
    applyPullRequestStage,
  });
});

export const layer = Layer.effect(JiraService, make);
