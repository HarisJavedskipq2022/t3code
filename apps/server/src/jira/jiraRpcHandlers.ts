import { JiraRpcGroup, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PromptEnhancement from "../promptEnhancement/PromptEnhancement.ts";
import * as JiraService from "./JiraService.ts";
import * as JiraTicketPrompt from "./JiraTicketPrompt.ts";

export const layerJiraRpcHandlers = JiraRpcGroup.toLayer(
  Effect.gen(function* () {
    const jira = yield* JiraService.JiraService;
    const ticketPrompt = yield* JiraTicketPrompt.JiraTicketPrompt;
    return JiraRpcGroup.of({
      [WS_METHODS.jiraSearchIssues]: (input) => jira.searchIssues(input),
      [WS_METHODS.jiraGetIssue]: (input) => jira.getIssue(input),
      [WS_METHODS.jiraListTransitions]: (input) => jira.listTransitions(input),
      [WS_METHODS.jiraTransitionIssue]: (input) => jira.transitionIssue(input),
      [WS_METHODS.jiraTestConnection]: () => jira.testConnection,
      [WS_METHODS.jiraEnhanceTicketPrompt]: (input) => ticketPrompt.enhance(input),
    });
  }),
).pipe(
  Layer.provide(
    JiraTicketPrompt.layer.pipe(
      Layer.provideMerge(JiraService.layer),
      Layer.provide(PromptEnhancement.layer),
    ),
  ),
);
