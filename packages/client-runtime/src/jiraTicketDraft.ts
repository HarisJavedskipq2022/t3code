import type { JiraIssueDetail, JiraIssueSummary, ThreadLinkedTicket } from "@t3tools/contracts";
import { sanitizeBranchFragment } from "@t3tools/shared/git";

const SLUG_WORDS = 6;
const SLUG_LENGTH = 40;

/** `fix/shp-4158-print-card-stuck`: bugs get `fix/`, other issue types `feat/`. */
export function ticketBranchName(issue: Pick<JiraIssueSummary, "key" | "title" | "isBug">) {
  const words = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word.length > 0)
    .slice(0, SLUG_WORDS)
    .join("-")
    .slice(0, SLUG_LENGTH)
    .replace(/-+$/g, "");
  const fragment = sanitizeBranchFragment(words.length > 0 ? `${issue.key}-${words}` : issue.key);
  return `${issue.isBug ? "fix" : "feat"}/${fragment}`;
}

export function linkedTicketOf(issue: JiraIssueSummary): ThreadLinkedTicket {
  return {
    provider: "jira",
    key: issue.key,
    url: issue.url,
    ...(issue.title ? { title: issue.title } : {}),
    isBug: issue.isBug,
  };
}

/** The first message: what to do, then the ticket as the reporter wrote it. */
export function ticketPrompt(issue: JiraIssueDetail): string {
  const verb = issue.isBug ? "Fix" : "Implement";
  const sections = [
    `${verb} ${issue.key}: ${issue.title}`,
    issue.description.trim(),
    issue.attachments.length > 0
      ? [
          "Attachments:",
          ...issue.attachments.map((attachment) => `- ${attachment.filename}: ${attachment.url}`),
        ].join("\n")
      : "",
    `Ticket: ${issue.url}`,
  ];
  return sections.filter((section) => section.length > 0).join("\n\n");
}

export interface TicketDraft {
  readonly ticket: ThreadLinkedTicket;
  readonly branch: string;
}

interface Bootstrap {
  readonly createThread?: object;
  readonly prepareWorktree?: object;
}

/**
 * Adds a ticket draft to the first send's bootstrap: the new thread carries the
 * ticket, and a new worktree gets the ticket's branch instead of a generated name.
 */
export function withTicketBootstrap<B extends Bootstrap>(
  bootstrap: B | undefined,
  draft: TicketDraft | null,
): B | undefined {
  if (draft === null || bootstrap === undefined) return bootstrap;
  return {
    ...bootstrap,
    ...(bootstrap.createThread
      ? { createThread: { ...bootstrap.createThread, linkedTicket: draft.ticket } }
      : {}),
    ...(bootstrap.prepareWorktree
      ? { prepareWorktree: { ...bootstrap.prepareWorktree, branch: draft.branch } }
      : {}),
  };
}

/** Whether an environment's server has a Jira login to search and start from tickets. */
export function isJiraConfigured(
  jira: { readonly siteUrl: string; readonly email: string; readonly apiToken: string } | undefined,
): boolean {
  return Boolean(jira?.siteUrl && jira.email && jira.apiToken);
}
