import {
  CommandId,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { jiraPullRequestEffects } from "./jiraPullRequestStages.ts";

const now = DateTime.makeUnsafe("2026-10-19T12:00:00.000Z");
const threadId = ThreadId.make("thread-1");
const commandId = CommandId.make("command-1");
const url = "https://github.com/acme/app/pull/7";

const thread: OrchestrationV2AppThread = {
  createdBy: "user",
  creationSource: "web",
  id: threadId,
  projectId: ProjectId.make("project-1"),
  title: "Print card stuck",
  providerInstanceId: ProviderInstanceId.make("codex"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "fix/shp-4158-print-card-stuck",
  worktreePath: "/tmp/worktree",
  linkedTicket: {
    provider: "jira",
    key: "SHP-4158",
    url: "https://team.atlassian.net/browse/SHP-4158",
  },
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};

const link = (state: "open" | "merged" | null): ThreadPullRequestLink => ({
  host: "github.com",
  repository: "acme/app",
  number: 7,
  url,
  source: "created",
  linkedAt: "2026-10-19T12:00:00.000Z",
  snapshot:
    state === null
      ? null
      : {
          state,
          title: "Fix print card",
          headBranch: "fix/shp-4158-print-card-stuck",
          baseBranch: "main",
          isDraft: false,
          updatedAt: null,
          syncedAt: "2026-10-19T12:00:00.000Z",
        },
  stack: null,
});

const branchPullRequest = {
  projectId: thread.projectId,
  repository: "acme/app",
  number: 7,
  url,
};

const requests = (before: OrchestrationV2AppThread, after: OrchestrationV2AppThread) =>
  jiraPullRequestEffects(before, after, commandId).map((effect) => [effect.id, effect.request]);

describe("jiraPullRequestEffects", () => {
  it("updates the ticket when its thread opens a first pull request", () => {
    expect(requests(thread, { ...thread, pullRequests: [link(null)] })).toEqual([
      [
        `effect:jira:thread-1:opened:${url}`,
        { type: "jira.pull-request-stage", key: "SHP-4158", stage: "opened", pullRequestUrl: url },
      ],
    ]);
  });

  it("links a pull request found only from the branch, so its merge is tracked", () => {
    expect(requests(thread, { ...thread, branchPullRequest })).toEqual([
      [
        `effect:jira:thread-1:opened:${url}`,
        {
          type: "jira.pull-request-stage",
          key: "SHP-4158",
          stage: "opened",
          pullRequestUrl: url,
          linkBranchPullRequest: branchPullRequest,
        },
      ],
    ]);
  });

  it("updates the ticket once when a linked pull request merges", () => {
    const open = { ...thread, pullRequests: [link("open")] };
    const merged = { ...thread, pullRequests: [link("merged")] };
    expect(requests(open, merged)).toEqual([
      [
        `effect:jira:thread-1:merged:${url}`,
        { type: "jira.pull-request-stage", key: "SHP-4158", stage: "merged", pullRequestUrl: url },
      ],
    ]);
    expect(requests(merged, { ...merged, title: "Renamed" })).toEqual([]);
  });

  it("leaves threads without a ticket, and later pull requests, alone", () => {
    const { linkedTicket: _ticket, ...plain } = thread;
    expect(requests(plain, { ...plain, pullRequests: [link(null)] })).toEqual([]);
    const second = { ...link(null), number: 8, url: "https://github.com/acme/app/pull/8" };
    const withOne = { ...thread, pullRequests: [link("open")] };
    expect(requests(withOne, { ...withOne, pullRequests: [link("open"), second] })).toEqual([]);
  });
});
