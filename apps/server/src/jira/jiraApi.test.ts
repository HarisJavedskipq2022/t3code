import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import {
  findTransitionTo,
  jiraIssueKeyOf,
  jiraSearchJql,
  makeJiraApi,
  normalizeJiraSiteUrl,
} from "./jiraApi.ts";

const credentials = {
  siteUrl: "team.atlassian.net",
  email: "dev@example.com",
  apiToken: "token-secret",
};
const AUTHORIZATION = `Basic ${Buffer.from("dev@example.com:token-secret").toString("base64")}`;

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

const issue = (key: string, overrides: Record<string, unknown> = {}) => ({
  key,
  fields: {
    summary: "Print card stuck",
    status: { name: "To Do", statusCategory: { key: "new" } },
    issuetype: { name: "Bug" },
    ...overrides,
  },
});

function fixture(route: (request: Recorded) => { status: number; body?: unknown }) {
  const requests: Recorded[] = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      expect(request.headers.authorization).toBe(AUTHORIZATION);
      const url = new URL(request.url);
      expect(url.origin).toBe("https://team.atlassian.net");
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
  return { requests, api: makeJiraApi.pipe(Effect.provideService(HttpClient.HttpClient, http)) };
}

describe("Jira API", () => {
  it.effect("goes straight to an issue for a key and reads it as a bug summary", () =>
    Effect.gen(function* () {
      const test = fixture(({ path }) =>
        path.startsWith("/rest/api/3/issue/SHP-4158")
          ? { status: 200, body: issue("SHP-4158") }
          : { status: 404 },
      );
      const api = yield* test.api;
      expect(yield* api.searchIssues(credentials, " shp-4158 ")).toEqual([
        {
          key: "SHP-4158",
          url: "https://team.atlassian.net/browse/SHP-4158",
          title: "Print card stuck",
          issueType: "Bug",
          isBug: true,
          status: "To Do",
          statusCategory: "new",
        },
      ]);
      expect(yield* api.searchIssues(credentials, "SHP-9999")).toEqual([]);
    }),
  );

  it.effect("reads acceptance criteria by field name and the latest comments", () =>
    Effect.gen(function* () {
      const paragraph = (text: string) => ({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      const test = fixture(() => ({
        status: 200,
        body: {
          ...issue("SHP-4158", {
            description: paragraph("Card never leaves loading."),
            customfield_10034: paragraph("Retrying prints the label"),
            customfield_10050: "Story points are not criteria",
            comment: {
              comments: [
                ...Array.from({ length: 6 }, (_, index) => ({
                  author: { displayName: "Dana" },
                  created: `2026-10-2${index}T09:00:00.000+0000`,
                  body: paragraph(`Note ${index}`),
                })),
                { author: { displayName: "Sam" }, body: paragraph("x".repeat(2_000)) },
                { author: { displayName: "Bot" }, body: paragraph("  ") },
              ],
            },
          }),
          names: { customfield_10034: "Acceptance Criteria", customfield_10050: "Story Points" },
        },
      }));
      const detail = yield* (yield* test.api).getIssue(credentials, "SHP-4158");
      expect(test.requests[0]?.path).toBe("/rest/api/3/issue/SHP-4158?fields=*all&expand=names");
      expect(detail.acceptanceCriteria).toBe("Retrying prints the label");
      expect(detail.comments.map((comment) => comment.body.slice(0, 6))).toEqual([
        "Note 2",
        "Note 3",
        "Note 4",
        "Note 5",
        "xxxxxx",
      ]);
      expect(detail.comments[0]).toEqual({
        author: "Dana",
        created: "2026-10-22T09:00:00.000+0000",
        body: "Note 2",
      });
      expect(detail.comments[4]?.body).toHaveLength(1_501);
    }),
  );

  it.effect("searches text with escaped JQL", () =>
    Effect.gen(function* () {
      const test = fixture(() => ({
        status: 200,
        body: { issues: [issue("SHP-1", { assignee: null })] },
      }));
      const api = yield* test.api;
      const found = yield* api.searchIssues(credentials, 'label "stuck"');
      expect(found.map((summary) => summary.key)).toEqual(["SHP-1"]);
      expect(found[0]).not.toHaveProperty("assignee");
      expect(test.requests[0]).toMatchObject({
        method: "POST",
        path: "/rest/api/3/search/jql",
        body: { jql: 'text ~ "label \\"stuck\\"" ORDER BY updated DESC' },
      });
    }),
  );

  it.effect("comments a pull request once, even when retried", () =>
    Effect.gen(function* () {
      const url = "https://github.com/acme/app/pull/7";
      let comments: unknown[] = [];
      const test = fixture(({ method, body }) => {
        if (method === "GET") return { status: 200, body: { comments } };
        comments = [...comments, body];
        return { status: 201, body: {} };
      });
      const api = yield* test.api;
      yield* api.commentOnce(credentials, "SHP-1", "Pull request opened:", url);
      yield* api.commentOnce(credentials, "SHP-1", "Pull request opened:", url);
      expect(test.requests.filter((request) => request.method === "POST")).toHaveLength(1);
    }),
  );

  it.effect("names the login problem without echoing the token", () =>
    Effect.gen(function* () {
      const test = fixture(() => ({ status: 401 }));
      const api = yield* test.api;
      const error = yield* Effect.flip(api.myself(credentials));
      expect(error.reason).toBe("unauthorized");
      expect(error.message).not.toContain("token-secret");
      const missing = yield* Effect.flip(api.myself({ ...credentials, apiToken: "" }));
      expect(missing.reason).toBe("notConfigured");
    }),
  );
});

describe("Jira helpers", () => {
  it("normalizes a site and spots issue keys", () => {
    expect(normalizeJiraSiteUrl("team.atlassian.net/browse/SHP-1")).toBe(
      "https://team.atlassian.net",
    );
    expect(normalizeJiraSiteUrl("http://team.atlassian.net")).toBeNull();
    expect(normalizeJiraSiteUrl("")).toBeNull();
    expect(jiraIssueKeyOf("shp-12")).toBe("SHP-12");
    expect(jiraIssueKeyOf("fix the label")).toBeNull();
    expect(jiraSearchJql("")).toContain("assignee = currentUser()");
  });

  it("finds a transition by the status it leads to", () => {
    const transitions = [
      { id: "11", name: "Start", toStatus: "In Progress" },
      { id: "21", name: "Send to review", toStatus: "In Review" },
    ];
    expect(findTransitionTo(transitions, "in review")?.id).toBe("21");
    expect(findTransitionTo(transitions, "start")?.id).toBe("11");
    expect(findTransitionTo(transitions, "Done")).toBeNull();
    expect(findTransitionTo(transitions, "")).toBeNull();
  });
});
