import { describe, expect, it } from "vite-plus/test";

import {
  commandOutputFilters,
  formatTestSummary,
  leadingSetupCount,
  parseTestSummary,
  splitCommandSteps,
} from "./forkCommandSteps.ts";

const worktreeTestRun = [
  "W=/tmp/shp/baseline-wt && rm -rf $W && git worktree add --detach $W HEAD >/dev/null 2>&1",
  '&& ln -s "$PWD/app_2/node_modules" $W/app_2/node_modules 2>/dev/null; cp app_2/.env* $W/app_2/ 2>/dev/null;',
  'cd $W/app_2 && pnpm exec vitest run src/a.test.tsx --testTimeout=10000 2>&1 | grep -E "Tests |×" | head -12',
].join(" ");

describe("splitCommandSteps", () => {
  it("splits at top-level operators and marks the setup that leads up to the work", () => {
    const steps = splitCommandSteps(worktreeTestRun);
    expect(steps.map((step) => step.text.split(" ")[0])).toEqual([
      "W=/tmp/shp/baseline-wt",
      "rm",
      "git",
      "ln",
      "cp",
      "cd",
      "pnpm",
    ]);
    expect(steps.map((step) => step.joiner)).toEqual([null, "&&", "&&", "&&", ";", ";", "&&"]);
    expect(leadingSetupCount(steps)).toBe(6);
    expect(steps.at(-1)?.setup).toBe(false);
  });

  it("keeps quoted operators, substitutions, redirects and pipes inside one step", () => {
    const steps = splitCommandSteps(
      `echo "a && b; c" && x=$(foo && bar) && run 2>&1 &> log | tee out || echo 'failed; really'`,
    );
    expect(steps.map((step) => [step.joiner, step.text])).toEqual([
      [null, 'echo "a && b; c"'],
      ["&&", "x=$(foo && bar)"],
      ["&&", "run 2>&1 &> log | tee out"],
      ["||", "echo 'failed; really'"],
    ]);
  });

  it("treats an env-prefixed program as work, and keeps a heredoc whole", () => {
    expect(splitCommandSteps("NODE_ENV=test vitest run")[0]?.setup).toBe(false);
    const heredoc = "python3 - <<'EOF'\nprint('a && b')\nEOF";
    expect(splitCommandSteps(heredoc)).toEqual([{ text: heredoc, joiner: null, setup: false }]);
  });

  it("drops blank steps and comments", () => {
    expect(splitCommandSteps("; a ;; # note && b\nc").map((step) => step.text)).toEqual(["a", "c"]);
  });
});

describe("commandOutputFilters", () => {
  it("names what the last step's output was piped through", () => {
    expect(commandOutputFilters(splitCommandSteps(worktreeTestRun))).toEqual(["grep", "head -12"]);
    expect(commandOutputFilters(splitCommandSteps("git log | tail -n 5 | less"))).toEqual([
      "tail -5",
    ]);
    expect(commandOutputFilters(splitCommandSteps("a | grep x && b"))).toEqual([]);
    expect(commandOutputFilters(splitCommandSteps("echo 'x | grep y'"))).toEqual([]);
  });
});

describe("parseTestSummary", () => {
  it("reads vitest, jest, pytest, node and cargo summaries", () => {
    expect(parseTestSummary(" × fails 3012ms\n      Tests  8 failed | 24 passed (32)\n")).toEqual({
      failed: 8,
      passed: 24,
      skipped: 0,
    });
    expect(parseTestSummary("Tests:       2 failed, 1 skipped, 9 passed, 12 total")).toEqual({
      failed: 2,
      passed: 9,
      skipped: 1,
    });
    expect(parseTestSummary("===== 3 failed, 40 passed in 2.31s =====")).toEqual({
      failed: 3,
      passed: 40,
      skipped: 0,
    });
    expect(parseTestSummary("# tests 5\n# pass 4\n# fail 1\n")).toEqual({
      failed: 1,
      passed: 4,
      skipped: 0,
    });
    expect(parseTestSummary("test result: FAILED. 24 passed; 8 failed; 0 ignored")).toEqual({
      failed: 8,
      passed: 24,
      skipped: 0,
    });
  });

  it("formats as the row shows it, leaving out zero failures and skips", () => {
    expect(formatTestSummary({ failed: 8, passed: 24, skipped: 0 })).toBe("8 failed · 24 passed");
    expect(formatTestSummary({ failed: 0, passed: 5, skipped: 2 })).toBe("5 passed · 2 skipped");
  });

  it("ignores color codes, and output with no summary", () => {
    expect(
      parseTestSummary("\u001b[1m Tests \u001b[22m \u001b[31m1 failed\u001b[39m | 2 passed"),
    ).toEqual({ failed: 1, passed: 2, skipped: 0 });
    expect(parseTestSummary("Tests passed\nall good")).toBeNull();
    expect(parseTestSummary("")).toBeNull();
  });
});
