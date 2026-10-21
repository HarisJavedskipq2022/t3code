import { describe, expect, it } from "vite-plus/test";

import { inlineFilePatch } from "./forkCodeChunks.logic";

describe("inlineFilePatch", () => {
  it("adds a file header to bare hunks and keeps a full patch as it is", () => {
    const hunk = "@@ -2,3 +2,3 @@\n export function tip() {\n-  a\n+  b\n }";
    expect(inlineFilePatch("src/tip.js", hunk)).toBe(`--- a/src/tip.js\n+++ b/src/tip.js\n${hunk}`);
    const full = `--- a/x\n+++ b/x\n${hunk}`;
    expect(inlineFilePatch("x", full)).toBe(full);
  });

  it("skips new-file contents, tool results, and edits too long for the timeline", () => {
    expect(inlineFilePatch("a.md", "# Title\nbody")).toBeNull();
    expect(inlineFilePatch("a.md", '{"type":"create","content":"x"}')).toBeNull();
    expect(inlineFilePatch("a.md", undefined)).toBeNull();
    const huge = `@@ -1,400 +1,400 @@\n${"+x\n".repeat(400)}`;
    expect(inlineFilePatch("a.md", huge)).toBeNull();
  });
});
