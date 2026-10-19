import { describe, expect, it } from "vite-plus/test";

import { jiraDocumentToText } from "./jiraDocument.ts";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });

describe("jiraDocumentToText", () => {
  it("keeps headings, lists, code, and links readable", () => {
    expect(
      jiraDocumentToText({
        type: "doc",
        version: 1,
        content: [
          { type: "heading", attrs: { level: 2 }, content: [text("Steps")] },
          {
            type: "orderedList",
            content: [
              { type: "listItem", content: [paragraph(text("Print a label"))] },
              {
                type: "listItem",
                content: [
                  paragraph(text("Wait for the carrier")),
                  {
                    type: "bulletList",
                    content: [{ type: "listItem", content: [paragraph(text("it times out"))] }],
                  },
                ],
              },
            ],
          },
          paragraph(
            text("See "),
            { type: "inlineCard", attrs: { url: "https://example.com/log" } },
            { type: "hardBreak" },
            { type: "mention", attrs: { text: "@Sam" } },
          ),
          { type: "codeBlock", attrs: { language: "ts" }, content: [text("retry()")] },
          { type: "mediaSingle", content: [{ type: "media", attrs: { id: "x" } }] },
        ],
      }),
    ).toBe(
      [
        "## Steps",
        "1. Print a label\n2. Wait for the carrier\n  - it times out",
        "See https://example.com/log\n@Sam",
        "```ts\nretry()\n```",
      ].join("\n\n"),
    );
  });

  it("passes plain strings through and ignores what it cannot read", () => {
    expect(jiraDocumentToText("  already text  ")).toBe("already text");
    expect(jiraDocumentToText(null)).toBe("");
    expect(jiraDocumentToText({ type: "doc", content: [42, { type: "unknown" }] })).toBe("");
  });
});
