import { describe, expect, it } from "vite-plus/test";

import { ticketBranchName, ticketPrompt, withTicketBootstrap } from "./ticketDraft.logic";

const issue = {
  key: "SHP-4158",
  url: "https://team.atlassian.net/browse/SHP-4158",
  title: `Print card stuck on "Generating label" after carrier timeout`,
  issueType: "Bug",
  isBug: true,
  status: "To Do",
  statusCategory: "new" as const,
  description: "When the carrier API times out, the card never leaves the loading state.",
  attachments: [{ filename: "trace.har", url: "https://team.atlassian.net/a/1" }],
};

const ticket = { provider: "jira" as const, key: issue.key, url: issue.url };

describe("ticketBranchName", () => {
  it("names bugs fix/ and other work feat/, from the first words of the title", () => {
    expect(ticketBranchName(issue)).toBe("fix/shp-4158-print-card-stuck-on-generating-label");
    expect(ticketBranchName({ ...issue, isBug: false, title: "Add A6 labels!" })).toBe(
      "feat/shp-4158-add-a6-labels",
    );
    expect(ticketBranchName({ ...issue, title: "???" })).toBe("fix/shp-4158");
  });
});

describe("ticketPrompt", () => {
  it("leads with the task, then the ticket's text, files, and link", () => {
    expect(ticketPrompt(issue)).toBe(
      [
        `Fix SHP-4158: ${issue.title}`,
        issue.description,
        "Attachments:\n- trace.har: https://team.atlassian.net/a/1",
        `Ticket: ${issue.url}`,
      ].join("\n\n"),
    );
    expect(ticketPrompt({ ...issue, isBug: false, description: "", attachments: [] })).toBe(
      `Implement SHP-4158: ${issue.title}\n\nTicket: ${issue.url}`,
    );
  });
});

describe("withTicketBootstrap", () => {
  const bootstrap = {
    createThread: { title: "Draft" },
    prepareWorktree: { projectCwd: "/repo", baseBranch: "main" },
    runSetupScript: true,
  };

  it("links the ticket and names the new worktree's branch", () => {
    expect(withTicketBootstrap(bootstrap, { ticket, branch: "fix/shp-4158" })).toEqual({
      createThread: { title: "Draft", linkedTicket: ticket },
      prepareWorktree: { projectCwd: "/repo", baseBranch: "main", branch: "fix/shp-4158" },
      runSetupScript: true,
    });
  });

  it("keeps the draft's own workspace when it is not a new worktree", () => {
    expect(
      withTicketBootstrap({ createThread: { title: "Draft" } }, { ticket, branch: "fix/x" }),
    ).toEqual({ createThread: { title: "Draft", linkedTicket: ticket } });
    expect(withTicketBootstrap(bootstrap, null)).toBe(bootstrap);
    expect(withTicketBootstrap(undefined, { ticket, branch: "fix/x" })).toBeUndefined();
  });
});
