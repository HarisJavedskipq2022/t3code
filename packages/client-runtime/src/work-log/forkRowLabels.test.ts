import { describe, expect, it } from "vite-plus/test";

import { compactCommandLabel, withToolQuery } from "./forkRowLabels.ts";

const root = "/Users/me/.t3code-fork/worktrees/ship-nest/feat-shp-3783";

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
