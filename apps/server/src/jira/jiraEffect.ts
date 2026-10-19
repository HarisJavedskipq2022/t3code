import { CommandId, type ThreadId, type ThreadLinkedPullRequest } from "@t3tools/contracts";
import { legacyThreadPullRequestKey } from "@t3tools/shared/threadPullRequests";
import * as Effect from "effect/Effect";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as JiraService from "./JiraService.ts";

export const runJiraPullRequestStage = (input: {
  readonly effectId: string;
  readonly threadId: ThreadId;
  readonly key: string;
  readonly stage: "opened" | "merged";
  readonly pullRequestUrl: string;
  readonly linkBranchPullRequest?: ThreadLinkedPullRequest | undefined;
}) =>
  Effect.gen(function* () {
    const jira = yield* JiraService.JiraService;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const branchPullRequest = input.linkBranchPullRequest;
    if (branchPullRequest) {
      // A fixed command id: a retried effect's link is deduplicated by its receipt.
      yield* threads
        .dispatch({
          type: "thread.pull-request.link",
          commandId: CommandId.make(`server:jira-link:${input.effectId}`),
          threadId: input.threadId,
          ...legacyThreadPullRequestKey(branchPullRequest),
          url: branchPullRequest.url,
          source: "manual",
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("could not link the ticket thread's pull request", { cause }),
          ),
        );
    }
    yield* jira.applyPullRequestStage({
      key: input.key,
      pullRequestUrl: input.pullRequestUrl,
      stage: input.stage,
    });
  });
