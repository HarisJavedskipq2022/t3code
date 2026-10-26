import { describe, expect, it } from "vite-plus/test";

import {
  commandRowLabel,
  compactCommandLabel,
  withTildeHome,
  withToolQuery,
} from "./forkRowLabels.ts";

const root = "/Users/me/.t3code-fork/worktrees/ship-nest/feat-shp-3783";

describe("commandRowLabel", () => {
  it("leads with the step the provider described", () => {
    expect(commandRowLabel("ls node_modules | grep eslint", "Find the ESLint plugin", root)).toBe(
      "Find the ESLint plugin",
    );
  });

  it("falls back to the command for a generic title or one that repeats it", () => {
    expect(commandRowLabel(`cd ${root} && git status`, "Command", root)).toBe("git status");
    expect(commandRowLabel("git status --short", "`git status --short`")).toBe(
      "git status --short",
    );
    expect(commandRowLabel("cat /Users/me/.zshrc", undefined)).toBe("cat ~/.zshrc");
  });
});

describe("withTildeHome", () => {
  it("shows home folders as ~ wherever a path starts", () => {
    expect(withTildeHome("L=/Users/me/.local/share/lint; ls $L")).toBe(
      "L=~/.local/share/lint; ls $L",
    );
    expect(withTildeHome('cd "/home/dev/app" && ls /Users/me')).toBe('cd "~/app" && ls ~');
  });

  it("leaves other absolute paths alone", () => {
    expect(withTildeHome("ls /usr/local/Users/x /tmp/home/y")).toBe(
      "ls /usr/local/Users/x /tmp/home/y",
    );
  });
});

describe("compactCommandLabel", () => {
  it("drops a cd into the workspace and shortens one into a subfolder", () => {
    expect(compactCommandLabel(`cd ${root} && git status --short`, root)).toBe(
      "git status --short",
    );
    expect(compactCommandLabel(`cd ${root}/app_2/src && pnpm test -- run`, `${root}/`)).toBe(
      "cd app_2/src && pnpm test -- run",
    );
    expect(compactCommandLabel(`cd "${root}/my app"; ls`, root)).toBe("cd my app && ls");
  });

  it("keeps the last two folders of a cd outside a known workspace", () => {
    expect(compactCommandLabel("cd /opt/data/exports/today && ls -la")).toBe(
      "cd …/exports/today && ls -la",
    );
    expect(compactCommandLabel("cd src && ls")).toBe("cd src && ls");
  });

  it("names an inline heredoc script instead of printing it", () => {
    const script = `cd ${root}/app_2 && python3 - <<'EOF'\np = 'a.tsx'\ns = open(p).read()\nprint(s)\nEOF`;
    expect(compactCommandLabel(script, root)).toBe("Python script · 3 lines");
    expect(compactCommandLabel("node <<EOF\nconsole.log(1)\nEOF")).toBe(
      "JavaScript script · 1 line",
    );
  });

  it("leaves other commands alone", () => {
    expect(compactCommandLabel("  pnpm test  ", root)).toBe("pnpm test");
    expect(compactCommandLabel("cat <<EOF > notes.md\nhi\nEOF")).toBe(
      "cat <<EOF > notes.md\nhi\nEOF",
    );
  });
});

describe("withToolQuery", () => {
  it("adds the query a bare tool title ran", () => {
    expect(withToolQuery("Search", { query: "order page  tabs", repo: root })).toBe(
      "Search “order page tabs”",
    );
    expect(withToolQuery("Search", { query: "x".repeat(80) })).toBe(`Search “${"x".repeat(59)}…”`);
  });

  it("leaves titles without a query, or already naming it, alone", () => {
    expect(withToolQuery("Search", { repo: root })).toBe("Search");
    expect(withToolQuery("Searched for tabs", { query: "tabs" })).toBe("Searched for tabs");
    expect(withToolQuery("Search", null)).toBe("Search");
  });
});
