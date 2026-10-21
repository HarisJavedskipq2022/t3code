// Past this many lines an edit belongs in the diff panel, not the timeline.
const INLINE_DIFF_MAX_LINES = 300;

/**
 * A unified patch for one file, given as hunks alone or with its `---`/`+++`
 * header, ready to parse. Null for anything else a provider stores in
 * `diffStr`, such as a new file's contents or a tool's JSON result.
 */
export function inlineFilePatch(fileName: string, diffStr: string | undefined): string | null {
  const text = diffStr?.trim();
  if (!text || !/^@@ -\d/mu.test(text)) return null;
  if (text.split("\n").length > INLINE_DIFF_MAX_LINES) return null;
  if (/^(?:diff --git |--- )/u.test(text)) return text;
  return `--- a/${fileName}\n+++ b/${fileName}\n${text}`;
}
