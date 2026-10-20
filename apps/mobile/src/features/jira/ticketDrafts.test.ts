import { describe, expect, it } from "vite-plus/test";

import { mergeTicketPrompt } from "./ticketDrafts";

describe("mergeTicketPrompt", () => {
  it("fills an empty draft and keeps what was already typed", () => {
    expect(mergeTicketPrompt("  \n", "Fix SHP-4158")).toBe("Fix SHP-4158");
    expect(mergeTicketPrompt("Also check the logs\n", "Fix SHP-4158")).toBe(
      "Also check the logs\n\nFix SHP-4158",
    );
  });
});
