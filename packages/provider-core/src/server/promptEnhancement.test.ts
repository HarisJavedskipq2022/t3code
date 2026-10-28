import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { keepsContextLinks, makeEnhancePrompt } from "./promptEnhancement.ts";
import { type Runner, withoutInvestigation } from "./textGenerationOperations.ts";

const modelSelection = { instanceId: ProviderInstanceId.make("grok"), model: "grok-fast" };

describe("makeEnhancePrompt", () => {
  it.effect("falls back to a plain rewrite when the provider cannot read code", () =>
    Effect.gen(function* () {
      const asked: Array<boolean> = [];
      const run: Runner = (request) =>
        Effect.sync(() => {
          asked.push(request.investigate !== undefined);
          return { prompt: "  Fix the card  " };
        }) as never;
      const enhance = makeEnhancePrompt("Grok", withoutInvestigation("Grok", run));
      expect(
        yield* enhance({ cwd: "/repo", draft: "fix", readCode: true, modelSelection }),
      ).toEqual({ prompt: "Fix the card", readCode: false });
      expect(asked).toEqual([false]);

      const investigating = makeEnhancePrompt("Claude", run);
      expect(
        yield* investigating({ cwd: "/repo", draft: "fix", readCode: true, modelSelection }),
      ).toEqual({ prompt: "Fix the card", readCode: true });
      expect(asked).toEqual([false, true]);
    }),
  );
});

describe("keepsContextLinks", () => {
  it("requires every attachment link in the draft to survive the rewrite", () => {
    const draft = "See [a](t3-context://v1/file/a) and [b](t3-context://v1/file/b).";
    expect(
      keepsContextLinks(draft, "Look at [a](t3-context://v1/file/a), [b](t3-context://v1/file/b)"),
    ).toBe(true);
    expect(keepsContextLinks(draft, "Look at [a](t3-context://v1/file/a)")).toBe(false);
    expect(keepsContextLinks("plain", "anything")).toBe(true);
  });
});
