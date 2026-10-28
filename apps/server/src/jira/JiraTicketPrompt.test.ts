import { describe, expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PromptEnhancement from "../promptEnhancement/PromptEnhancement.ts";
import * as JiraService from "./JiraService.ts";
import * as JiraTicketPrompt from "./JiraTicketPrompt.ts";

const issue = {
  key: "SHP-4158",
  url: "https://team.atlassian.net/browse/SHP-4158",
  title: "Print card stuck",
  issueType: "Bug",
  isBug: true,
  status: "To Do",
  statusCategory: "new" as const,
  description: "Card never leaves loading.",
  acceptanceCriteria: "",
  comments: [],
  attachments: [],
};

describe("JiraTicketPrompt", () => {
  it.effect("rewrites the ticket draft without reading code and keeps the ticket link", () =>
    Effect.gen(function* () {
      const requests: Array<{ readonly draft: string; readonly readCode: boolean }> = [];
      const layer = JiraTicketPrompt.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(JiraService.JiraService)({ getIssue: () => Effect.succeed(issue) }),
            Layer.mock(PromptEnhancement.PromptEnhancement)({
              enhance: (input) => {
                requests.push({ draft: input.draft, readCode: input.readCode });
                return Effect.succeed({
                  prompt: "Fix SHP-4158: Print card stuck",
                  readCode: false,
                });
              },
            }),
          ),
        ),
      );
      const result = yield* Effect.flatMap(JiraTicketPrompt.JiraTicketPrompt, (service) =>
        service.enhance({ key: issue.key, projectId: ProjectId.make("project-1") }),
      ).pipe(Effect.provide(layer));
      expect(result).toEqual({ prompt: `Fix SHP-4158: Print card stuck\n\nTicket: ${issue.url}` });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.readCode).toBe(false);
      expect(requests[0]?.draft).toContain("## Description\n\nCard never leaves loading.");
    }),
  );
});
