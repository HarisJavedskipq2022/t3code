import { describe, expect, it } from "vite-plus/test";

import { enhancedDraftText, promptEnhancementStatus } from "./promptEnhancement.ts";

describe("enhancedDraftText", () => {
  const template = "Fix SHP-4158: Print card stuck\n\nTicket: https://x/browse/SHP-4158";
  const enhanced = "Fix SHP-4158: Print card stuck\n\n## Goal\n\nThe card leaves loading.";

  it("swaps in the rewrite, keeping text typed before a ticket template", () => {
    expect(
      enhancedDraftText({ current: template, original: template, replace: template, enhanced }),
    ).toBe(enhanced);
    const original = `Also check reprints.\n\n${template}`;
    expect(
      enhancedDraftText({ current: `${original}\n`, original, replace: template, enhanced }),
    ).toBe(`Also check reprints.\n\n${enhanced}`);
  });

  it("leaves an edited draft alone", () => {
    expect(
      enhancedDraftText({
        current: `${template} today`,
        original: template,
        replace: template,
        enhanced,
      }),
    ).toBeNull();
  });
});

describe("promptEnhancementStatus", () => {
  it("shows running and undo only while the draft is the text they act on", () => {
    const running = {
      state: "running",
      original: "fix it",
      replace: "fix it",
      readCode: true,
    } as const;
    expect(promptEnhancementStatus(running, "fix it\n")).toBe("running");
    expect(promptEnhancementStatus(running, "fix it now")).toBe("idle");
    const done = {
      state: "done",
      original: "fix it",
      enhanced: "## Goal",
      readCode: true,
    } as const;
    expect(promptEnhancementStatus(done, "## Goal")).toBe("undoable");
    expect(promptEnhancementStatus(done, "## Goal, edited")).toBe("idle");
    expect(promptEnhancementStatus(undefined, "anything")).toBe("idle");
  });
});
