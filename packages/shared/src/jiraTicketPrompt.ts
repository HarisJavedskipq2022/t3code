import type { JiraIssueDetail } from "@t3tools/contracts";

const BUG_CONSTRAINTS = [
  "Find the cause in the code before changing anything, and say what it was.",
  "Add or update a test that fails without the fix.",
  "Keep the change to what this ticket asks; mention anything else you notice instead of fixing it.",
];
const FEATURE_CONSTRAINTS = [
  "Find where this belongs in the code and follow the patterns already there.",
  "Cover the acceptance criteria with tests where the code around it has them.",
  "Keep the change to what this ticket asks; ask before widening the scope.",
];

function section(title: string, body: string): string {
  const text = body.trim();
  return text.length === 0 ? "" : `## ${title}\n\n${text}`;
}

/**
 * The first message for a thread started from a ticket: the task, the ticket as its people
 * wrote it, and how to go about it. Instant and offline; the server may rewrite it later.
 */
export function ticketPrompt(issue: JiraIssueDetail): string {
  const verb = issue.isBug ? "Fix" : "Implement";
  const discussion = issue.comments.map((comment) => {
    const date = comment.created.slice(0, 10);
    const byline = [comment.author || "Someone", date].filter((part) => part.length > 0);
    return `**${byline.join(", ")}**\n${comment.body.trim()}`;
  });
  const sections = [
    `${verb} ${issue.key}: ${issue.title}`,
    section("Description", issue.description),
    section("Acceptance criteria", issue.acceptanceCriteria),
    section("Discussion", discussion.join("\n\n")),
    section(
      "Attachments",
      issue.attachments
        .map((attachment) => `- ${attachment.filename}: ${attachment.url}`)
        .join("\n"),
    ),
    section(
      "Constraints",
      (issue.isBug ? BUG_CONSTRAINTS : FEATURE_CONSTRAINTS).map((line) => `- ${line}`).join("\n"),
    ),
    `Ticket: ${issue.url}`,
  ];
  return sections.filter((text) => text.length > 0).join("\n\n");
}
