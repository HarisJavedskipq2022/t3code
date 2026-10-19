import { useClientSettings } from "../../hooks/useSettings";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";
import type {
  SidebarDropTarget,
  SidebarListItem,
  SidebarListMarker,
  SidebarSection,
} from "../Sidebar.logic";

type ThreadItem = Extract<SidebarListItem, { kind: "thread" }>;
type ProjectRef = { readonly environmentId: string; readonly projectId: string };

const MARKER_PREFIX = "project-group:";

// The section goes last so a project key can never make the marker look like
// a placeholder, whose id the sortable rows match by suffix.
function projectGroupMarker(groupKey: string, section: SidebarSection): SidebarListMarker {
  return `${MARKER_PREFIX}${groupKey}@${section}`;
}

export function parseProjectGroupMarker(marker: SidebarListMarker): string | null {
  if (!marker.startsWith(MARKER_PREFIX)) return null;
  return marker.slice(MARKER_PREFIX.length, marker.lastIndexOf("@"));
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

// Pinned is ordered by hand, so it stays one list.
export function insertProjectGroupHeaders(
  section: SidebarSection,
  items: readonly ThreadItem[],
  groupOf: (item: ThreadItem) => string | undefined,
): SidebarListItem[] {
  if (section === "pinned") return [...items];
  const result: SidebarListItem[] = [];
  let current: string | undefined;
  for (const item of groupByFirstAppearance(items, (entry) => groupOf(entry) ?? "")) {
    const group = groupOf(item);
    if (group !== undefined && group !== current) {
      result.push({ kind: "marker", marker: projectGroupMarker(group, section) });
    }
    current = group;
    result.push(item);
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
  return (section: SidebarSection, list: readonly ThreadItem[]) =>
    insertProjectGroupHeaders(
      section,
      list,
      (item) => item.projectGroup ?? groupByKey.get(item.key),
    );
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

export function SidebarProjectGroupLabel(props: { project: SidebarProjectSnapshot | null }) {
  const { project } = props;
  return (
    <div className="flex h-7 items-end gap-1.5 px-2 pb-1 text-xs font-medium text-sidebar-muted-foreground/60">
      {project ? <ProjectFavicon project={project} className="size-3.5 shrink-0" /> : null}
      <span className="min-w-0 truncate">{project?.displayName ?? "Unknown project"}</span>
      <span aria-hidden className="mb-1.5 h-px min-w-2 flex-1 bg-sidebar-border/60" />
    </div>
  );
}
