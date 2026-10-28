import { describe, expect, it } from "vite-plus/test";

import { ticketPrompt } from "./jiraTicketPrompt.ts";

const issue = {
  key: "SHP-4158",
  url: "https://team.atlassian.net/browse/SHP-4158",
  title: "Print card stuck after carrier timeout",
  issueType: "Bug",
  isBug: true,
  status: "To Do",
  statusCategory: "new" as const,
  description: "When the carrier API times out, the card never leaves the loading state.",
  acceptanceCriteria: "- The card shows the timeout error\n- Retrying prints the label",
  comments: [
    {
      author: "Dana",
      created: "2026-10-20T09:12:00.000+0000",
      body: "Seen with UPS only.",
    },
  ],
  attachments: [{ filename: "trace.har", url: "https://team.atlassian.net/a/1" }],
};

describe("ticketPrompt", () => {
  it("leads with the task, then the ticket in sections, constraints, and the link", () => {
    const prompt = ticketPrompt(issue);
    expect(prompt.split("\n\n## ").map((part) => part.split("\n")[0])).toEqual([
      "Fix SHP-4158: Print card stuck after carrier timeout",
      "Description",
      "Acceptance criteria",
      "Discussion",
      "Attachments",
      "Constraints",
    ]);
    expect(prompt).toContain("**Dana, 2026-10-20**\nSeen with UPS only.");
    expect(prompt).toContain("- trace.har: https://team.atlassian.net/a/1");
    expect(prompt).toContain("Add or update a test that fails without the fix.");
    expect(prompt.endsWith(`Ticket: ${issue.url}`)).toBe(true);
  });

  it("leaves out sections the ticket has nothing for", () => {
    const prompt = ticketPrompt({
      ...issue,
      isBug: false,
      description: " ",
      acceptanceCriteria: "",
      comments: [],
      attachments: [],
    });
    expect(prompt.split("\n\n## ").map((part) => part.split("\n")[0])).toEqual([
      "Implement SHP-4158: Print card stuck after carrier timeout",
      "Constraints",
    ]);
  });
});
