/**
 * Jira Cloud returns descriptions as Atlassian Document Format, a JSON tree.
 * An agent reads plain text better, and only the words and structure matter.
 */
interface DocumentNode {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: ReadonlyArray<unknown>;
}

const BLOCK_TYPES = new Set([
  "blockquote",
  "codeBlock",
  "panel",
  "rule",
  "table",
  "tableRow",
  "mediaSingle",
  "mediaGroup",
]);

function asNode(value: unknown): DocumentNode | null {
  return typeof value === "object" && value !== null ? (value as DocumentNode) : null;
}

function attr(node: DocumentNode, name: string): string | null {
  const value = node.attrs?.[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function inline(nodes: ReadonlyArray<unknown> | undefined): string {
  return (nodes ?? []).map((child) => render(child, "")).join("");
}

function render(value: unknown, indent: string): string {
  const node = asNode(value);
  if (node === null) return "";
  switch (node.type) {
    case "text":
      return typeof node.text === "string" ? node.text : "";
    case "hardBreak":
      return "\n";
    case "mention":
      return attr(node, "text") ?? "";
    case "emoji":
      return attr(node, "text") ?? attr(node, "shortName") ?? "";
    case "inlineCard":
    case "blockCard":
      return attr(node, "url") ?? "";
    case "status":
      return attr(node, "text") ?? "";
    case "paragraph":
      return inline(node.content);
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      return `${"#".repeat(level)} ${inline(node.content)}`;
    }
    case "codeBlock":
      return `\`\`\`${attr(node, "language") ?? ""}\n${inline(node.content)}\n\`\`\``;
    case "rule":
      return "---";
    case "bulletList":
    case "orderedList":
      return (node.content ?? [])
        .map((item, index) => {
          const marker = node.type === "orderedList" ? `${index + 1}.` : "-";
          return renderListItem(item, indent, marker);
        })
        .join("\n");
    case "tableRow":
      return `| ${(node.content ?? []).map((cell) => blocks(asNode(cell)?.content, "").replace(/\n+/g, " ")).join(" | ")} |`;
    case "media":
    case "mediaSingle":
    case "mediaGroup":
      return "";
    default:
      return BLOCK_TYPES.has(String(node.type)) || node.type === "doc"
        ? blocks(node.content, indent)
        : inline(node.content);
  }
}

function renderListItem(value: unknown, indent: string, marker: string): string {
  const children = asNode(value)?.content ?? [];
  const nested = `${indent}  `;
  return children
    .map((child, index) => {
      const type = asNode(child)?.type;
      if (type === "bulletList" || type === "orderedList") return render(child, nested);
      const text = render(child, nested);
      return index === 0 ? `${indent}${marker} ${text}` : `${nested}${text}`;
    })
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function blocks(nodes: ReadonlyArray<unknown> | undefined, indent: string): string {
  return (nodes ?? [])
    .map((child) => render(child, indent))
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

export function jiraDocumentToText(document: unknown): string {
  if (typeof document === "string") return document.trim();
  return render(document, "").trim();
}

/** A comment body: one paragraph whose link Jira renders as a card. */
export function jiraCommentDocument(text: string, url: string) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: `${text} ` },
          { type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] },
        ],
      },
    ],
  };
}
