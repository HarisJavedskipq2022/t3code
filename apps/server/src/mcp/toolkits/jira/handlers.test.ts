import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as JiraService from "../../../jira/JiraService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as JiraHandlers from "./handlers.ts";
import { JiraToolkit } from "./tools.ts";

const linkedThread = ThreadId.make("jira-linked-thread");
const plainThread = ThreadId.make("jira-plain-thread");

const scopeFor = (
  threadId: ThreadId | undefined,
  overrides: Partial<McpInvocationContext.McpInvocationScope> = {},
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("jira-environment"),
  requestNamespace: "jira-session",
  thread:
    threadId === undefined
      ? undefined
      : {
          threadId,
          providerSessionId: "jira-session",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration", "pull-requests"]),
  ...overrides,
});

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "jira-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "jira-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

const issue = (status: string) => ({
  key: "SHP-7",
  fields: {
    summary: "Labels print blank",
    status: { name: status, statusCategory: { key: "indeterminate" } },
    issuetype: { name: "Bug" },
    assignee: { displayName: "Ada Lovelace" },
    description: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Steps to reproduce" }] }],
    },
  },
});

/** A Jira double: records every request and answers from `route`. */
function jiraDouble(route: (request: Recorded) => { status: number; body?: unknown }) {
  const requests: Recorded[] = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const url = new URL(request.url);
      const body =
        request.body._tag === "Uint8Array"
          ? JSON.parse(new TextDecoder().decode(request.body.body))
          : undefined;
      const recorded = { method: request.method, path: `${url.pathname}${url.search}`, body };
      requests.push(recorded);
      const response = route(recorded);
      return HttpClientResponse.fromWeb(
        request,
        response.body === undefined
          ? new Response(null, { status: response.status })
          : Response.json(response.body, { status: response.status }),
      );
    }),
  );
  return { requests, http };
}

const connected = {
  jira: { siteUrl: "team.atlassian.net", email: "dev@example.com", apiToken: "token-secret" },
};

function call(
  double: ReturnType<typeof jiraDouble>,
  name: string,
  args: Record<string, unknown>,
  options: {
    readonly scope?: McpInvocationContext.McpInvocationScope;
    readonly settings?: Parameters<typeof ServerSettings.layerTest>[0];
  } = {},
) {
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({ name, arguments: args })
      .pipe(
        Effect.provideService(
          McpInvocationContext.McpInvocationContext,
          options.scope ?? scopeFor(linkedThread),
        ),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    const text = result.content[0];
    return result.isError === true && text?.type === "text"
      ? { failure: JSON.parse(text.text) }
      : { success: result.structuredContent };
  }).pipe(
    Effect.provide(
      McpHttpServer.toolkitRegistration(JiraToolkit, JiraHandlers.layer).pipe(
        Layer.provideMerge(McpServer.McpServer.layer),
        Layer.provide(JiraService.layer),
        Layer.provide(ServerSettings.layerTest(options.settings ?? connected)),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, double.http)),
        Layer.provide(
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadShell: (threadId) =>
              Effect.succeed(
                threadId === linkedThread
                  ? {
                      ...liveThreadShell(threadId),
                      linkedTicket: {
                        provider: "jira",
                        key: "SHP-7",
                        url: "https://team.atlassian.net/browse/SHP-7",
                      },
                    }
                  : liveThreadShell(threadId),
              ),
          }),
        ),
      ),
    ),
  );
}

it.effect("reads the thread's linked ticket when no key is given", () =>
  Effect.gen(function* () {
    const double = jiraDouble(() => ({ status: 200, body: issue("In Progress") }));
    const result = yield* call(double, "t3_jira_read_ticket", {});
    expect(result.success).toMatchObject({
      key: "SHP-7",
      url: "https://team.atlassian.net/browse/SHP-7",
      title: "Labels print blank",
      status: "In Progress",
      assignee: "Ada Lovelace",
      description: "Steps to reproduce",
    });
    expect(double.requests[0]?.path).toMatch(/^\/rest\/api\/3\/issue\/SHP-7\?fields=.*assignee/);
  }),
);

it.effect("asks for a key when the thread has no linked ticket", () =>
  Effect.gen(function* () {
    const double = jiraDouble(() => ({ status: 500 }));
    const fromThread = yield* call(
      double,
      "t3_jira_list_transitions",
      {},
      {
        scope: scopeFor(plainThread),
      },
    );
    expect(fromThread.failure).toMatchObject({
      code: "target_required",
      message: "Pass key: this thread was not started from a Jira ticket.",
    });
    const fromClient = yield* call(
      double,
      "t3_jira_read_ticket",
      {},
      { scope: scopeFor(undefined) },
    );
    expect(fromClient.failure).toMatchObject({ code: "target_required" });
    expect(double.requests).toHaveLength(0);
  }),
);

it.effect("explains that Jira is not connected without calling it", () =>
  Effect.gen(function* () {
    const double = jiraDouble(() => ({ status: 500 }));
    const result = yield* call(
      double,
      "t3_jira_search_tickets",
      { query: "labels" },
      {
        settings: {},
      },
    );
    expect(result.failure).toMatchObject({ code: "invalid_request" });
    expect(result.failure.message).toContain("Settings → Integrations");
    expect(double.requests).toHaveLength(0);
  }),
);

it.effect("searches with raw JQL and refuses query and jql together", () =>
  Effect.gen(function* () {
    const double = jiraDouble(() => ({ status: 200, body: { issues: [issue("To Do")] } }));
    const jql = 'project = SHP AND status = "To Do"';
    const result = yield* call(double, "t3_jira_search_tickets", { jql });
    expect(result.success).toMatchObject({ issues: [{ key: "SHP-7", assignee: "Ada Lovelace" }] });
    expect(double.requests[0]).toMatchObject({
      method: "POST",
      path: "/rest/api/3/search/jql",
      body: { jql },
    });
    const both = yield* call(double, "t3_jira_search_tickets", { jql, query: "labels" });
    expect(both.failure).toMatchObject({ code: "invalid_request" });
    expect(double.requests).toHaveLength(1);
  }),
);

it.effect("posts a plain-text comment as paragraphs and links to it", () =>
  Effect.gen(function* () {
    const double = jiraDouble(() => ({ status: 201, body: { id: "10042" } }));
    const result = yield* call(double, "t3_jira_add_comment", {
      key: "SHP-7",
      text: "Fixed in #12.\nNeeds a deploy.\n\nVerified locally.",
    });
    expect(result.success).toEqual({
      key: "SHP-7",
      commentId: "10042",
      url: "https://team.atlassian.net/browse/SHP-7?focusedCommentId=10042",
    });
    expect(double.requests[0]).toMatchObject({
      method: "POST",
      path: "/rest/api/3/issue/SHP-7/comment",
      body: {
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Fixed in #12." },
                { type: "hardBreak" },
                { type: "text", text: "Needs a deploy." },
              ],
            },
            { type: "paragraph", content: [{ type: "text", text: "Verified locally." }] },
          ],
        },
      },
    });
  }),
);

it.effect("moves a ticket and returns its new status", () =>
  Effect.gen(function* () {
    const double = jiraDouble(({ method }) =>
      method === "POST" ? { status: 204 } : { status: 200, body: issue("In Review") },
    );
    const result = yield* call(double, "t3_jira_transition_ticket", {
      key: "SHP-7",
      transitionId: "31",
    });
    expect(result.success).toMatchObject({ key: "SHP-7", status: "In Review" });
    expect(double.requests[0]).toMatchObject({
      method: "POST",
      path: "/rest/api/3/issue/SHP-7/transitions",
      body: { transition: { id: "31" } },
    });
  }),
);

it.effect("passes on why Jira rejected a transition", () =>
  Effect.gen(function* () {
    const double = jiraDouble(() => ({
      status: 400,
      body: { errorMessages: ["Transition id '99' is not valid for this issue."] },
    }));
    const result = yield* call(double, "t3_jira_transition_ticket", {
      key: "SHP-7",
      transitionId: "99",
    });
    expect(result.failure).toMatchObject({
      code: "orchestration_error",
      message: "Jira: Transition id '99' is not valid for this issue.",
    });
  }),
);

it.effect("keeps Jira behind the pull-requests grant and writes away from read-only clients", () =>
  Effect.gen(function* () {
    const double = jiraDouble(() => ({ status: 201, body: { id: "1" } }));
    const denied = yield* call(
      double,
      "t3_jira_read_ticket",
      { key: "SHP-7" },
      {
        scope: scopeFor(linkedThread, { capabilities: new Set(["orchestration"]) }),
      },
    );
    expect(denied.failure).toMatchObject({ code: "capability_denied" });
    const readOnly = yield* call(
      double,
      "t3_jira_add_comment",
      { key: "SHP-7", text: "hi" },
      {
        scope: scopeFor(undefined, {
          client: { sessionId: "client", label: "client", access: "read-only" },
        }),
      },
    );
    expect(readOnly.failure).toMatchObject({ code: "capability_denied" });
    expect(double.requests).toHaveLength(0);
  }),
);
