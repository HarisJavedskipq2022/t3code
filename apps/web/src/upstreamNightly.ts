/**
 * Fork-only: notices when upstream T3 Code publishes a nightly newer than the
 * one this fork build was synced to. The fork stamps the nightly it merged as
 * its version (scripts/fork-sync.sh), so the two compare directly.
 */
const UPSTREAM_RELEASES_URL = "https://api.github.com/repos/pingdotgg/t3code/releases?per_page=10";
export const UPSTREAM_RELEASE_TAG_URL = "https://github.com/pingdotgg/t3code/releases/tag";

const NIGHTLY_VERSION = /^v?(\d+)\.(\d+)\.(\d+)-nightly\.(\d+)\.(\d+)$/;

/** Ordering key for a nightly version or tag; null for anything else, such as dev builds. */
function nightlyKey(version: string): ReadonlyArray<number> | null {
  const match = NIGHTLY_VERSION.exec(version.trim());
  return match ? match.slice(1).map(Number) : null;
}

function compareKeys(left: ReadonlyArray<number>, right: ReadonlyArray<number>): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The newest nightly tag ahead of `currentVersion`, or null when it is current or not a nightly. */
export function newerUpstreamNightly(
  currentVersion: string,
  tags: ReadonlyArray<string>,
): string | null {
  const current = nightlyKey(currentVersion);
  if (current === null) return null;
  let newest: { tag: string; key: ReadonlyArray<number> } | null = null;
  for (const tag of tags) {
    const key = nightlyKey(tag);
    if (key === null || compareKeys(key, current) <= 0) continue;
    if (newest === null || compareKeys(key, newest.key) > 0) newest = { tag, key };
  }
  return newest?.tag ?? null;
}

/** Recent upstream release tags, newest first; empty when GitHub cannot be reached. */
export async function fetchUpstreamReleaseTags(
  signal: AbortSignal,
): Promise<ReadonlyArray<string>> {
  try {
    const response = await fetch(UPSTREAM_RELEASES_URL, {
      signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return [];
    const releases: unknown = await response.json();
    if (!Array.isArray(releases)) return [];
    return releases.flatMap((release: unknown) =>
      typeof release === "object" &&
      release !== null &&
      "tag_name" in release &&
      typeof release.tag_name === "string"
        ? [release.tag_name]
        : [],
    );
  } catch {
    return [];
  }
}
