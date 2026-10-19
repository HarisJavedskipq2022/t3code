import { ChevronDownIcon } from "lucide-react";
import { Schema } from "effect";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  resolveSidebarThreadStatus,
  type SidebarDropTarget,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "../Sidebar.logic";

type ThreadItem = Extract<SidebarListItem, { kind: "thread" }>;
type ProjectRef = { readonly environmentId: string; readonly projectId: string };

const MARKER_PREFIX = "project-group:";

// The section goes last so a project key can never make the marker look like
// a placeholder, whose id the sortable rows match by suffix.
export function projectGroupMarker(groupKey: string, section: SidebarSection): SidebarListMarker {
  return `${MARKER_PREFIX}${groupKey}@${section}`;
}

function parseMarker(marker: SidebarListMarker) {
  if (!marker.startsWith(MARKER_PREFIX)) return null;
  const at = marker.lastIndexOf("@");
  return { groupKey: marker.slice(MARKER_PREFIX.length, at), section: marker.slice(at + 1) };
}

export function parseProjectGroupMarker(marker: SidebarListMarker): string | null {
  return parseMarker(marker)?.groupKey ?? null;
}

/** Thread project ref to its sidebar project group key, or null while grouping is off. */
export function useSidebarProjectGroupKeys(
  projectGroups: readonly Pick<SidebarProjectSnapshot, "projectKey" | "memberProjectRefs">[],
  scoped: boolean,
): ReadonlyMap<string, string> | null {
  const enabled = useClientSettings((settings) => settings.sidebarGroupByProjectEnabled);
  // A project scope already shows a single project.
  if (!enabled || scoped) return null;
  return new Map(
    projectGroups.flatMap((group) =>
      group.memberProjectRefs.map((ref) => [projectRefKey(ref), group.projectKey] as const),
    ),
  );
}

function projectRefKey(ref: ProjectRef): string {
  return `${ref.environmentId}:${ref.projectId}`;
}

export function resolveThreadProjectGroup(
  thread: ProjectRef,
  groupKeys: ReadonlyMap<string, string>,
): string {
  const key = projectRefKey(thread);
  return groupKeys.get(key) ?? key;
}

/** Groups follow their first item, so the section's own order still decides which project leads. */
export function groupByFirstAppearance<T>(items: readonly T[], groupOf: (item: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = groupOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()].flat();
}

export function groupThreadsByProject<T extends ProjectRef>(
  threads: readonly T[],
  groupKeys: ReadonlyMap<string, string> | null,
): readonly T[] {
  if (groupKeys === null) return threads;
  return groupByFirstAppearance(threads, (thread) => resolveThreadProjectGroup(thread, groupKeys));
}

// Groups present in the rows keep their order; a folded group with no rows
// left stays after the group it followed.
function mergeGroupOrder(present: readonly string[], known: readonly string[]): string[] {
  const order = [...present];
  known.forEach((key, index) => {
    if (order.includes(key)) return;
    const previous = known.slice(0, index).findLast((candidate) => order.includes(candidate));
    order.splice(previous === undefined ? 0 : order.indexOf(previous) + 1, 0, key);
  });
  return order;
}

// Pinned is ordered by hand, so it stays one list.
export function insertProjectGroupHeaders(
  section: SidebarSection,
  items: readonly ThreadItem[],
  groupOf: (item: ThreadItem) => string | undefined,
  knownGroups: readonly string[] = [],
): SidebarListItem[] {
  if (section === "pinned") return [...items];
  const rowsByGroup = new Map<string | undefined, ThreadItem[]>();
  for (const item of items) {
    const group = groupOf(item);
    const rows = rowsByGroup.get(group);
    if (rows) rows.push(item);
    else rowsByGroup.set(group, [item]);
  }
  const present = [...rowsByGroup.keys()].filter((group) => group !== undefined);
  const result: SidebarListItem[] = [...(rowsByGroup.get(undefined) ?? [])];
  for (const group of mergeGroupOrder(present, knownGroups)) {
    result.push({ kind: "marker", marker: projectGroupMarker(group, section) });
    result.push(...(rowsByGroup.get(group) ?? []));
  }
  return result;
}

function projectGroupByThreadKey(items: readonly SidebarListItem[]) {
  return new Map(
    items.flatMap((item) =>
      item.kind === "thread" && item.projectGroup !== undefined
        ? [[item.key, item.projectGroup] as const]
        : [],
    ),
  );
}

/** For the drag projection, whose settled rows are rebuilt from keys alone. */
export function createProjectGroupExpander(items: readonly SidebarListItem[]) {
  const groupByKey = projectGroupByThreadKey(items);
  const groupsBySection = new Map<string, string[]>();
  for (const item of items) {
    const parsed = item.kind === "marker" ? parseMarker(item.marker) : null;
    if (parsed === null) continue;
    const groups = groupsBySection.get(parsed.section);
    if (groups) groups.push(parsed.groupKey);
    else groupsBySection.set(parsed.section, [parsed.groupKey]);
  }
  return (section: SidebarSection, list: readonly ThreadItem[]) =>
    insertProjectGroupHeaders(
      section,
      list,
      (item) => item.projectGroup ?? groupByKey.get(item.key),
      groupsBySection.get(section),
    );
}

const COLLAPSED_PROJECT_GROUPS_KEY = "t3code:sidebar:collapsed-project-groups";
const NO_COLLAPSED_PROJECT_GROUPS: readonly string[] = [];
const CollapsedProjectGroups = Schema.Array(Schema.String);

/** Folded groups are per device, keyed by section so folding Settled leaves Active alone. */
export function useCollapsedProjectGroups() {
  const [collapsedMarkers, setCollapsedMarkers] = useLocalStorage(
    COLLAPSED_PROJECT_GROUPS_KEY,
    NO_COLLAPSED_PROJECT_GROUPS,
    CollapsedProjectGroups,
  );
  return {
    collapsedGroups: new Set(collapsedMarkers),
    toggleProjectGroup: (marker: SidebarListMarker) =>
      setCollapsedMarkers((current) =>
        current.includes(marker)
          ? current.filter((candidate) => candidate !== marker)
          : [...current, marker],
      ),
  };
}

// A folded group must not hide a thread that is waiting on the user.
export function threadNeedsUser(thread: Parameters<typeof resolveSidebarThreadStatus>[0]) {
  const status = resolveSidebarThreadStatus(thread);
  return status === "approval" || status === "input" || status === "failed";
}

export interface ProjectGroupHeader {
  readonly key: string;
  readonly count: number;
  readonly collapsed: boolean;
}

/** Hides the rows of folded groups, keeping the ones `keep` allows, and reports every group's header. */
export function foldProjectGroups<T extends ProjectRef>(input: {
  readonly section: SidebarSection;
  readonly threads: readonly T[];
  readonly groupKeys: ReadonlyMap<string, string> | null;
  readonly collapsedGroups: ReadonlySet<string>;
  readonly keep: (thread: T) => boolean;
}): { readonly visible: readonly T[]; readonly headers: readonly ProjectGroupHeader[] } {
  const { section, threads, groupKeys } = input;
  if (groupKeys === null) return { visible: threads, headers: [] };
  const counts = new Map<string, number>();
  for (const thread of threads) {
    const key = resolveThreadProjectGroup(thread, groupKeys);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const isCollapsed = (key: string) => input.collapsedGroups.has(projectGroupMarker(key, section));
  return {
    visible: threads.filter(
      (thread) => !isCollapsed(resolveThreadProjectGroup(thread, groupKeys)) || input.keep(thread),
    ),
    headers: [...counts].map(([key, count]) => ({ key, count, collapsed: isCollapsed(key) })),
  };
}

type OrderKeys = ReadonlyMap<string, string | null | undefined>;

/**
 * Rows that sit together in a group are rarely neighbours in the stored active
 * order, so a key midway between them can land anywhere. The drop is planned
 * against the regrouped order, and when the stored keys do not already follow
 * it they are withheld so the planner rewrites the section in that order.
 */
export function regroupActiveDrop(input: {
  readonly enabled: boolean;
  readonly target: SidebarDropTarget;
  readonly activeKey: string;
  readonly activeKeysById: OrderKeys;
  readonly items: readonly SidebarListItem[];
}): { readonly target: SidebarDropTarget; readonly activeKeysById: OrderKeys } {
  const { target, activeKey, activeKeysById } = input;
  if (!input.enabled || target.section !== "active") return { target, activeKeysById };
  const groupByKey = projectGroupByThreadKey(input.items);
  const activeOrder = groupByFirstAppearance(
    target.activeOrder,
    (key) => groupByKey.get(key) ?? "",
  );
  const neighbourKeys = activeOrder
    .filter((key) => key !== activeKey)
    .map((key) => activeKeysById.get(key) ?? null);
  const keysFollowOrder = neighbourKeys.every(
    (key, index) => key !== null && (index === 0 || neighbourKeys[index - 1]! < key),
  );
  return {
    target: { ...target, activeOrder },
    activeKeysById: keysFollowOrder
      ? activeKeysById
      : new Map([...activeKeysById, ...activeOrder.map((key) => [key, null] as const)]),
  };
}

export function indexProjectGroupHeaders(
  bySection: Readonly<Partial<Record<SidebarSection, readonly ProjectGroupHeader[]>>>,
): ReadonlyMap<SidebarListMarker, ProjectGroupHeader> {
  return new Map(
    (Object.entries(bySection) as [SidebarSection, readonly ProjectGroupHeader[]][]).flatMap(
      ([section, headers]) =>
        headers.map((header) => [projectGroupMarker(header.key, section), header] as const),
    ),
  );
}

export function SidebarProjectGroupHeader(props: {
  project: SidebarProjectSnapshot | null;
  header: ProjectGroupHeader | undefined;
  onToggle: () => void;
}) {
  const { project, header } = props;
  const collapsed = header?.collapsed === true;
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={props.onToggle}
      className="flex h-7 w-full cursor-pointer items-end gap-1.5 rounded-md px-2 pb-1 text-left text-xs font-medium text-sidebar-muted-foreground/60 hover:text-sidebar-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
    >
      {project ? <ProjectFavicon project={project} className="size-3.5 shrink-0" /> : null}
      <span className="min-w-0 truncate">{project?.displayName ?? "Unknown project"}</span>
      {collapsed && header ? <span className="shrink-0 tabular-nums">{header.count}</span> : null}
      <span aria-hidden className="mb-1.5 h-px min-w-2 flex-1 bg-sidebar-border/60" />
      <ChevronDownIcon
        aria-hidden
        className={cn("mb-0.5 size-3 shrink-0 transition-transform", collapsed && "-rotate-90")}
      />
    </button>
  );
}
