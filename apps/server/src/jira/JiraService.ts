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

export class JiraService extends Context.Service<
  JiraService,
  {
    readonly searchIssues: (
      input: JiraSearchIssuesInput,
    ) => Effect.Effect<JiraSearchIssuesResult, JiraError>;
    readonly getIssue: (input: JiraIssueInput) => Effect.Effect<JiraIssueDetail, JiraError>;
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

  const getIssue: JiraService["Service"]["getIssue"] = (input) =>
    credentials.pipe(Effect.flatMap((login) => api.getIssue(login, input.key)));

  const listTransitions: JiraService["Service"]["listTransitions"] = (input) =>
    credentials.pipe(
      Effect.flatMap((login) => api.listTransitions(login, input.key)),
      Effect.map((transitions) => ({ transitions })),
    );

  const transitionIssue: JiraService["Service"]["transitionIssue"] = (input) =>
    Effect.gen(function* () {
      const login = yield* credentials;
      yield* api.transitionIssue(login, input.key, input.transitionId);
      return yield* api.getIssue(login, input.key);
    });

  const testConnection = credentials.pipe(Effect.flatMap(api.myself));

  const applyPullRequestStage: JiraService["Service"]["applyPullRequestStage"] = (input) =>
    Effect.gen(function* () {
      const jira = yield* settings;
      if (!jira.siteUrl || !jira.email || !jira.apiToken) return;
      if (input.stage === "opened" && jira.commentOnPullRequest) {
        yield* api.commentOnce(jira, input.key, "Pull request opened:", input.pullRequestUrl);
      }
      const target = input.stage === "opened" ? jira.openedTransition : jira.mergedTransition;
      if (!target) return;
      const issue = yield* api.getIssue(jira, input.key);
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
    }).pipe(Effect.withSpan("JiraService.applyPullRequestStage"));

  return JiraService.of({
    searchIssues,
    getIssue,
    listTransitions,
    transitionIssue,
    testConnection,
    applyPullRequestStage,
  });
});

export const layer = Layer.effect(JiraService, make);
