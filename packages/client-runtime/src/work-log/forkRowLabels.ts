const CD_PREFIX = /^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)\s*/u;
const HEREDOC_SCRIPT =
  /^(python3?|node|bun|deno|ruby|perl|bash|sh|zsh)\s+(?:-\s+)?<<-?\s*['"]?([A-Za-z_]\w*)['"]?/u;
const SCRIPT_LANGUAGES: Readonly<Record<string, string>> = {
  python: "Python",
  python3: "Python",
  node: "JavaScript",
  bun: "JavaScript",
  deno: "JavaScript",
  ruby: "Ruby",
  perl: "Perl",
  bash: "Shell",
  sh: "Shell",
  zsh: "Shell",
};
const QUERY_MAX_LENGTH = 60;

function trimTrailingSlashes(path: string): string {
  return path.length > 1 ? path.replace(/[\\/]+$/u, "") : path;
}

/** `dir` as the row shows it: relative inside the workspace, else its last two folders. */
function shortDirectory(dir: string, workspaceRoot: string | null | undefined): string {
  const path = trimTrailingSlashes(dir);
  const root = workspaceRoot ? trimTrailingSlashes(workspaceRoot) : null;
  if (root !== null && path === root) return "";
  if (root !== null && path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  const segments = path.split("/").filter(Boolean);
  return path.startsWith("/") && segments.length > 2 ? `…/${segments.slice(-2).join("/")}` : path;
}

function heredocScriptLabel(command: string): string | null {
  const match = HEREDOC_SCRIPT.exec(command);
  if (!match) return null;
  const lines = command.split("\n");
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === match[2]);
  const bodyLines = (end === -1 ? lines.length : end) - 1;
  const language = SCRIPT_LANGUAGES[match[1]!] ?? "Inline";
  return bodyLines > 0
    ? `${language} script · ${bodyLines} ${bodyLines === 1 ? "line" : "lines"}`
    : `${language} script`;
}

/**
 * A command as its timeline row reads: a leading `cd` into the workspace drops
 * its absolute path, and an inline heredoc script is named instead of printed.
 * The expanded row still shows the full command.
 */
export function compactCommandLabel(command: string, workspaceRoot?: string | null): string {
  const text = command.trim();
  const cd = CD_PREFIX.exec(text);
  const rest = cd ? text.slice(cd[0].length) : text;
  const script = heredocScriptLabel(rest);
  if (script !== null) return script;
  if (!cd) return text;
  const dir = shortDirectory(cd[1] ?? cd[2] ?? cd[3] ?? "", workspaceRoot);
  return dir === "" ? rest : `cd ${dir} && ${rest}`;
}

/** A bare tool title with the query it ran, e.g. `Search “order page tabs”`. */
export function withToolQuery(label: string, input: unknown): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return label;
  const record = input as Record<string, unknown>;
  const raw = [record.query, record.pattern, record.q].find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  if (raw === undefined) return label;
  const query = raw.trim().replace(/\s+/gu, " ");
  if (label.includes(query)) return label;
  const shown =
    query.length > QUERY_MAX_LENGTH ? `${query.slice(0, QUERY_MAX_LENGTH - 1)}…` : query;
  return `${label} “${shown}”`;
}
