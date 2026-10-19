import type { CommandId, OrchestrationV2AppThread } from "@t3tools/contracts";
import { threadPullRequestsOf } from "@t3tools/shared/threadPullRequests";

import type { PendingOrchestrationEffectV2 } from "../orchestration-v2/EffectOutbox.ts";

function pullRequestUrls(thread: OrchestrationV2AppThread): ReadonlySet<string> {
  return new Set([
    ...threadPullRequestsOf(thread).map((link) => link.url),
    ...(thread.branchPullRequest ? [thread.branchPullRequest.url] : []),
  ]);
}

/**
 * Ticket updates a thread mutation calls for. "opened" fires when a ticket's
 * thread gets its first pull request, "merged" when a linked pull request's
 * synced state turns merged. Ids are per thread, stage and URL, so the outbox
 * keeps a repeated sync from updating the ticket twice.
 */
export function jiraPullRequestEffects(
  before: OrchestrationV2AppThread,
  after: OrchestrationV2AppThread,
  commandId: CommandId,
): ReadonlyArray<PendingOrchestrationEffectV2> {
  const ticket = after.linkedTicket;
  if (!ticket || before === after) return [];
  const effect = (
    stage: "opened" | "merged",
    pullRequestUrl: string,
    branchOnly: boolean,
  ): PendingOrchestrationEffectV2 => ({
    id: `effect:jira:${after.id}:${stage}:${pullRequestUrl}`,
    commandId,
    threadId: after.id,
    request: {
      type: "jira.pull-request-stage",
      key: ticket.key,
      stage,
      pullRequestUrl,
      // Merges are only synced for linked pull requests, so a branch-only one gets linked.
      ...(branchOnly && after.branchPullRequest
        ? { linkBranchPullRequest: after.branchPullRequest }
        : {}),
    },
  });

  const effects: PendingOrchestrationEffectV2[] = [];
  if (pullRequestUrls(before).size === 0) {
    const links = threadPullRequestsOf(after);
    const first = links[0]?.url ?? after.branchPullRequest?.url;
    if (first) effects.push(effect("opened", first, links.length === 0));
  }
  const beforeStates = new Map(
    threadPullRequestsOf(before).map((link) => [link.url, link.snapshot?.state]),
  );
  for (const link of threadPullRequestsOf(after)) {
    if (link.snapshot?.state === "merged" && beforeStates.get(link.url) !== "merged") {
      effects.push(effect("merged", link.url, false));
    }
  }
  return effects;
}
