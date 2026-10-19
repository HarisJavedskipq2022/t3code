import { JiraRpcGroup, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as JiraService from "./JiraService.ts";

export const layerJiraRpcHandlers = JiraRpcGroup.toLayer(
  Effect.gen(function* () {
    const jira = yield* JiraService.JiraService;
    return JiraRpcGroup.of({
      [WS_METHODS.jiraSearchIssues]: (input) => jira.searchIssues(input),
      [WS_METHODS.jiraGetIssue]: (input) => jira.getIssue(input),
      [WS_METHODS.jiraListTransitions]: (input) => jira.listTransitions(input),
      [WS_METHODS.jiraTransitionIssue]: (input) => jira.transitionIssue(input),
      [WS_METHODS.jiraTestConnection]: () => jira.testConnection,
    });
  }),
).pipe(Layer.provide(JiraService.layer));
