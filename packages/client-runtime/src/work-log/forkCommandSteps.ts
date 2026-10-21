/**
 * Reading aids for an expanded shell command row: its top-level steps, which
 * of them only set the stage, what its output was piped through, and the test
 * summary its output reports. All of it is best-effort display; the row keeps
 * the original command for copying.
 */

export type CommandStepJoiner = "&&" | "||" | ";" | "&" | "\n";

export interface CommandStep {
  readonly text: string;
  /** The operator before this step; null for the first. */
  readonly joiner: CommandStepJoiner | null;
  /** Prepares for the real work (cd, rm, ln, env vars, worktree setup) rather than doing it. */
  readonly setup: boolean;
}

const SETUP_PROGRAMS = new Set([
  ".",
  ":",
  "cd",
  "chmod",
  "chown",
  "cp",
  "export",
  "ln",
  "mkdir",
  "mv",
  "popd",
  "pushd",
  "rm",
  "rmdir",
  "set",
  "source",
  "touch",
  "trap",
  "true",
  "unset",
]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

function words(step: string): string[] {
  return step.split(/\s+/u).filter(Boolean);
}

function isSetupStep(step: string): boolean {
  const parts = words(step);
  // `W=/tmp/x` alone sets a variable; `NODE_ENV=test vitest` runs vitest.
  const program = parts.find((part) => !ASSIGNMENT.test(part));
  if (program === undefined) return parts.length > 0;
  if (SETUP_PROGRAMS.has(program)) return true;
  return program === "git" && parts[parts.indexOf(program) + 1] === "worktree";
}

/**
 * Splits a command at its top-level `&&`, `||`, `;`, `&` and newlines, leaving
 * quotes, substitutions and pipes intact. A heredoc keeps the command whole:
 * its body is not shell syntax.
 */
export function splitCommandSteps(command: string): CommandStep[] {
  const source = command.trim();
  if (source === "") return [];
  if (/<<(?!<)/u.test(source)) return [{ text: source, joiner: null, setup: false }];

  const steps: Array<{ text: string; joiner: CommandStepJoiner | null }> = [];
  let start = 0;
  let joiner: CommandStepJoiner | null = null;
  let quote: "'" | '"' | "`" | null = null;
  let depth = 0;
  const push = (end: number, next: CommandStepJoiner, length: number) => {
    const text = source.slice(start, end).trim();
    // A blank step (`a ; ; b`, a trailing `;`) leaves the previous joiner in place.
    if (text !== "") {
      steps.push({ text, joiner });
      joiner = next;
    }
    start = end + length;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "{") depth += 1;
    else if ((char === ")" || char === "}") && depth > 0) depth -= 1;
    if (depth > 0) continue;
    // A comment runs to the end of the line.
    if (char === "#" && (index === 0 || /\s/u.test(source[index - 1]!))) {
      const newline = source.indexOf("\n", index);
      const end = newline === -1 ? source.length : newline;
      push(index, "\n", end + 1 - index);
      index = end;
      continue;
    }
    const next = source[index + 1];
    if (char === "&" && next === "&") push(index, "&&", 2);
    else if (char === "|" && next === "|") push(index, "||", 2);
    else if (char === ";" || char === "\n") push(index, char, 1);
    // `2>&1`, `&>` and `>&` redirect rather than background.
    else if (
      char === "&" &&
      next !== ">" &&
      source[index - 1] !== ">" &&
      source[index - 1] !== "<"
    ) {
      push(index, "&", 1);
    } else continue;
    if (char === "&" && next === "&") index += 1;
    else if (char === "|") index += 1;
  }
  push(source.length, ";", 0);

  return steps.map((step) => ({ ...step, setup: isSetupStep(step.text) }));
}

/** How many steps at the start only set up, worth folding when there are several. */
export function leadingSetupCount(steps: ReadonlyArray<CommandStep>): number {
  const firstWork = steps.findIndex((step) => !step.setup);
  return firstWork === -1 ? 0 : firstWork;
}

const OUTPUT_FILTERS = new Set([
  "awk",
  "cut",
  "egrep",
  "grep",
  "head",
  "jq",
  "rg",
  "sed",
  "sort",
  "tail",
  "tr",
  "uniq",
  "wc",
]);

function splitTopLevelPipes(step: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let quote: string | null = null;
  let depth = 0;
  for (let index = 0; index < step.length; index += 1) {
    const char = step[index]!;
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")" && depth > 0) depth -= 1;
    else if (char === "|" && depth === 0 && step[index + 1] !== "|" && step[index - 1] !== "|") {
      segments.push(step.slice(start, index));
      // `|&` pipes stderr too.
      start = step[index + 1] === "&" ? index + 2 : index + 1;
    }
  }
  segments.push(step.slice(start));
  return segments.map((segment) => segment.trim());
}

/**
 * The filters the last step pipes its output through, as short labels such as
 * `grep` or `head -12`: what the reader sees is not everything the command printed.
 */
export function commandOutputFilters(steps: ReadonlyArray<CommandStep>): string[] {
  const last = steps.at(-1);
  if (last === undefined) return [];
  return splitTopLevelPipes(last.text)
    .slice(1)
    .flatMap((segment) => {
      const [program, flag, value] = words(segment);
      if (program === undefined || !OUTPUT_FILTERS.has(program)) return [];
      if ((program === "head" || program === "tail") && flag !== undefined) {
        if (/^-\d+$/u.test(flag)) return [`${program} ${flag}`];
        if (flag === "-n" && value !== undefined && /^\d+$/u.test(value)) {
          return [`${program} -${value}`];
        }
      }
      return [program];
    });
}

export interface TestSummary {
  readonly failed: number;
  readonly passed: number;
  readonly skipped: number;
}

// oxlint-disable-next-line no-control-regex -- ANSI color codes start with the ESC control character.
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/gu;

function countsFrom(text: string): TestSummary | null {
  const count = (pattern: RegExp) => {
    const match = pattern.exec(text);
    return match ? Number(match[1]) : 0;
  };
  const failed = count(/(\d+) failed/u);
  const passed = count(/(\d+) passed/u);
  const skipped = count(/(\d+) (?:skipped|todo)/u);
  return failed + passed > 0 ? { failed, passed, skipped } : null;
}

/**
 * The pass and fail counts a test runner printed at the end of its output:
 * vitest and jest (`Tests  8 failed | 24 passed`), pytest (`== 8 failed, 24
 * passed in 1.2s ==`), node's test runner (`# pass 24`) and cargo (`test
 * result: FAILED. 24 passed; 8 failed`). Null when none is recognised.
 */
export function parseTestSummary(output: string): TestSummary | null {
  const text = output.replace(ANSI, "");
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim();
    const runner =
      /^Tests:?\s+(.*)$/u.exec(line)?.[1] ??
      /^=+\s+(.*\b(?:passed|failed)\b.*)\s+in\s+[\d.]+m?s\b.*=+$/u.exec(line)?.[1] ??
      /^test result: \w+\. (.*)$/u.exec(line)?.[1];
    if (runner !== undefined) {
      const summary = countsFrom(runner);
      if (summary !== null) return summary;
    }
  }
  const nodePass = /^# pass (\d+)$/mu.exec(text);
  const nodeFail = /^# fail (\d+)$/mu.exec(text);
  if (nodePass !== null || nodeFail !== null) {
    const skipped = /^# skipped (\d+)$/mu.exec(text);
    return {
      passed: Number(nodePass?.[1] ?? 0),
      failed: Number(nodeFail?.[1] ?? 0),
      skipped: Number(skipped?.[1] ?? 0),
    };
  }
  return null;
}

/** A summary as the row shows it, e.g. `8 failed · 24 passed`. */
export function formatTestSummary(summary: TestSummary): string {
  return [
    summary.failed > 0 ? `${summary.failed} failed` : null,
    `${summary.passed} passed`,
    summary.skipped > 0 ? `${summary.skipped} skipped` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
