import {
  JiraError,
  type JiraEnhanceTicketPromptInput,
  type JiraEnhanceTicketPromptResult,
} from "@t3tools/contracts";
import { ticketPrompt } from "@t3tools/shared/jiraTicketPrompt";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PromptEnhancement from "../promptEnhancement/PromptEnhancement.ts";
import * as JiraService from "./JiraService.ts";

export class JiraTicketPrompt extends Context.Service<
  JiraTicketPrompt,
  {
    /** Rewrites a ticket's draft into a structured agent prompt, without reading the code. */
    readonly enhance: (
      input: JiraEnhanceTicketPromptInput,
    ) => Effect.Effect<JiraEnhanceTicketPromptResult, JiraError>;
  }
>()("t3/jira/JiraTicketPrompt") {}

/** A rewrite keeps the link back to its ticket, even when the model drops it. */
function withTicketLink(prompt: string, url: string): string {
  return prompt.includes(url) ? prompt : `${prompt}\n\nTicket: ${url}`;
}

const make = Effect.gen(function* () {
  const jira = yield* JiraService.JiraService;
  const promptEnhancement = yield* PromptEnhancement.PromptEnhancement;

  const enhance = Effect.fn("JiraTicketPrompt.enhance")(function* (
    input: JiraEnhanceTicketPromptInput,
  ) {
    const issue = yield* jira.getIssue({ key: input.key });
    // Picking a ticket stays one quick model call; Enhance in the composer reads the code.
    const result = yield* promptEnhancement
      .enhance({ projectId: input.projectId, draft: ticketPrompt(issue), readCode: false })
      .pipe(Effect.mapError((error) => new JiraError({ reason: "request", detail: error.detail })));
    return { prompt: withTicketLink(result.prompt, issue.url) };
  });

  return JiraTicketPrompt.of({ enhance });
});

export const layer = Layer.effect(JiraTicketPrompt, make);
