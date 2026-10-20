import type { TicketDraft } from "@t3tools/client-runtime/jira-ticket-draft";

/**
 * The ticket a new-task draft starts from, by composer draft key. Kept beside the draft rather
 * than in its workspace selection, which every branch or mode change rebuilds. Memory only: a
 * draft reopened after a restart still has the ticket in its prompt, just not the link.
 */
const drafts = new Map<string, TicketDraft>();

export function setTicketDraft(draftKey: string, draft: TicketDraft | undefined): void {
  if (draft === undefined) drafts.delete(draftKey);
  else drafts.set(draftKey, draft);
}

export function clearTicketDraft(draftKey: string): void {
  drafts.delete(draftKey);
}

/** The `ticket` field of a queued creation, carried to the server on the first send. */
export function ticketCreationField(draftKey: string): { readonly ticket?: TicketDraft } {
  const draft = drafts.get(draftKey);
  return draft === undefined ? {} : { ticket: draft };
}

/** The ticket goes after anything already typed, so picking one never discards a draft. */
export function mergeTicketPrompt(existing: string, prompt: string): string {
  return existing.trim().length === 0 ? prompt : `${existing.trimEnd()}\n\n${prompt}`;
}
