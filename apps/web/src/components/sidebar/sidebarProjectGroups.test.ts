import type { SortingStrategy } from "@dnd-kit/sortable";
import { describe, expect, it } from "vite-plus/test";

import { createSidebarSortingStrategy } from "../Sidebar.drag";
import {
  planSidebarThreadDrop,
  resolveSidebarDropTarget,
  sidebarListItemId,
  type SidebarListItem,
  type SidebarSection,
} from "../Sidebar.logic";
import {
  foldProjectGroups,
  groupByFirstAppearance,
  insertProjectGroupHeaders,
  parseProjectGroupMarker,
  projectGroupMarker,
  regroupActiveDrop,
} from "./sidebarProjectGroups";

type ThreadItem = Extract<SidebarListItem, { kind: "thread" }>;

const row = (
  key: string,
  projectGroup: string,
  section: SidebarSection = "active",
): ThreadItem => ({
  kind: "thread",
  key,
  section,
  projectGroup,
});

const shape = (items: readonly SidebarListItem[]) =>
  items.map((item) =>
    item.kind === "thread" ? item.key : `# ${parseProjectGroupMarker(item.marker) ?? item.marker}`,
  );

function activeList(rows: readonly ThreadItem[]): SidebarListItem[] {
  return [
    { kind: "marker", marker: "pinned-header" },
    { kind: "marker", marker: "pinned-divider" },
    { kind: "marker", marker: "active-placeholder" },
    ...insertProjectGroupHeaders("active", rows, (item) => item.projectGroup),
    { kind: "marker", marker: "settled-header" },
    { kind: "marker", marker: "settled-placeholder" },
  ];
}

// Drops a row the way the sidebar does, then returns the active order the
// stored keys produce once regrouped, which is what the user sees next.
function dropActiveRow(input: {
  readonly rows: readonly ThreadItem[];
  readonly keys: Record<string, string>;
  readonly activeKey: string;
  readonly overKey: string;
}) {
  const items = activeList(input.rows);
  const activeKeysById = new Map(Object.entries(input.keys));
  const resolved = resolveSidebarDropTarget(items, input.activeKey, input.overKey)!;
  const { target, activeKeysById: plannedKeys } = regroupActiveDrop({
    enabled: true,
    target: resolved,
    activeKey: input.activeKey,
    activeKeysById,
    items,
  });
  const plan = planSidebarThreadDrop({
    activeKey: input.activeKey,
    activeSection: "active",
    target,
    pinnedOrder: [],
    pinnedKeysById: new Map(),
    activeOrder: input.rows.map((item) => item.key),
    activeKeysById: plannedKeys,
  });
  const storedKeys = new Map(activeKeysById);
  if (plan.kind === "move-active") {
    for (const { id, orderKey } of plan.assignments) storedKeys.set(id, orderKey);
  }
  const groupOf = new Map(input.rows.map((item) => [item.key, item.projectGroup!]));
  const shown = groupByFirstAppearance(
    [...storedKeys.keys()].toSorted((left, right) =>
      storedKeys.get(left)! < storedKeys.get(right)! ? -1 : 1,
    ),
    (key) => groupOf.get(key)!,
  );
  return { plan, preview: target.activeOrder, shown };
}

describe("sidebar project groups", () => {
  it("heads each project group in the order its first thread appears", () => {
    const rows = [row("a1", "A"), row("b1", "B"), row("a2", "A")];

    expect(shape(insertProjectGroupHeaders("active", rows, (item) => item.projectGroup))).toEqual([
      "# A",
      "a1",
      "a2",
      "# B",
      "b1",
    ]);
    expect(shape(insertProjectGroupHeaders("pinned", rows, (item) => item.projectGroup))).toEqual([
      "a1",
      "b1",
      "a2",
    ]);
  });

  it("lands a moved thread where the grouped preview showed it", () => {
    // Stored order interleaves projects (a1, b1, a2), shown grouped as a1, a2, b1.
    // Moving a1 below b1 previews A as a2, a1 under its header, above B.
    const result = dropActiveRow({
      rows: [row("a1", "A"), row("a2", "A"), row("b1", "B")],
      keys: { a1: "b", b1: "d", a2: "h" },
      activeKey: "a1",
      overKey: "b1",
    });

    expect(result.preview).toEqual(["a2", "a1", "b1"]);
    expect(result.shown).toEqual(["a2", "a1", "b1"]);
  });

  it("keeps the stored keys for a reorder inside a group they already follow", () => {
    const result = dropActiveRow({
      rows: [row("a1", "A"), row("a2", "A"), row("b1", "B")],
      keys: { a1: "b", a2: "d", b1: "h" },
      activeKey: "a2",
      overKey: "a1",
    });

    expect(result.plan).toMatchObject({ kind: "move-active", assignments: [{ id: "a2" }] });
    expect(result.shown).toEqual(["a2", "a1", "b1"]);
  });

  it("treats a drop into another project's group as no move", () => {
    const result = dropActiveRow({
      rows: [row("a1", "A"), row("a2", "A"), row("b1", "B"), row("b2", "B")],
      keys: { a1: "b", b1: "d", a2: "f", b2: "h" },
      activeKey: "a2",
      overKey: "b1",
    });

    expect(result.plan).toEqual({ kind: "none" });
  });

  it("keeps project headers in place while a row is dragged", () => {
    const items = activeList([row("a1", "A"), row("a2", "A"), row("b1", "B")]);
    const preview = dragPreview(items, (item) => (item.kind === "thread" ? 82 : 28), "a2", "a1");

    // Project B is untouched, so its row's shift is the baseline for everything that stays put.
    const baseline = preview("b1").y;
    expect(preview(header("A"))).toMatchObject({ y: baseline, scaleY: 1 });
    expect(preview(header("B"))).toMatchObject({ y: baseline, scaleY: 1 });
    // a1 slides down one card to make room for a2 above it.
    expect(preview("a1")).toMatchObject({ y: baseline + 83, scaleY: 1 });
  });

  it("folds a project group to its header, keeping threads that need the user", () => {
    const threads = [shell("a1", "pa"), shell("a2", "pa"), shell("b1", "pb")];
    const fold = (section: SidebarSection) =>
      foldProjectGroups({
        section,
        threads,
        groupKeys: new Map([
          ["env:pa", "A"],
          ["env:pb", "B"],
        ]),
        collapsedGroups: new Set([projectGroupMarker("A", "active")]),
        keep: (thread) => thread.id === "a2",
      });

    expect(fold("active").visible.map((thread) => thread.id)).toEqual(["a2", "b1"]);
    expect(fold("active").headers).toEqual([
      { key: "A", count: 2, collapsed: true },
      { key: "B", count: 1, collapsed: false },
    ]);
    // Folding A in Active leaves A's settled threads alone.
    expect(fold("settled").visible).toHaveLength(3);
  });

  it("keeps a fully folded group's header between its neighbours", () => {
    const rows = [row("a1", "A"), row("c1", "C")];

    expect(
      shape(
        insertProjectGroupHeaders("active", rows, (item) => item.projectGroup, ["A", "B", "C"]),
      ),
    ).toEqual(["# A", "a1", "# B", "# C", "c1"]);
  });

  it("previews a drag with folded headers and compact cards at their real sizes", () => {
    const items: SidebarListItem[] = [
      { kind: "marker", marker: "pinned-header" },
      row("p1", "A", "pinned"),
      { kind: "marker", marker: "pinned-divider" },
      { kind: "marker", marker: "active-placeholder" },
      ...insertProjectGroupHeaders(
        "active",
        [row("a1", "A"), row("a2", "A"), row("c1", "C")],
        (item) => item.projectGroup,
        ["A", "B", "C"],
      ),
      { kind: "marker", marker: "settled-header" },
      { kind: "marker", marker: "settled-placeholder" },
    ];
    // Pinned cards keep the full height; grouped cards are compact.
    const preview = dragPreview(
      items,
      (item) => (item.kind === "marker" ? 28 : item.section === "pinned" ? 82 : 54),
      "a2",
      "a1",
    );

    const baseline = preview("c1").y;
    expect(preview(header("B"))).toMatchObject({ y: baseline, scaleY: 1 });
    expect(preview("a1")).toMatchObject({ y: baseline + 55, scaleY: 1 });
  });
});

const header = (groupKey: string) => sidebarListItemId(marker(groupKey));
const marker = (groupKey: string): SidebarListItem => ({
  kind: "marker",
  marker: projectGroupMarker(groupKey, "active"),
});
const shell = (id: string, projectId: string) => ({ id, environmentId: "env", projectId });

// Zero-height markers stand in for the pinned boundaries and placeholders.
function dragPreview(
  items: readonly SidebarListItem[],
  heightOf: (item: SidebarListItem) => number,
  activeKey: string,
  overKey: string,
) {
  let top = 0;
  const rects = items.map((item) => {
    const height =
      item.kind === "marker" && parseProjectGroupMarker(item.marker) === null ? 0 : heightOf(item);
    const rect = { top, height, bottom: top + height, left: 0, right: 260, width: 260 };
    top += height + 1;
    return rect;
  });
  const indexOf = (key: string) => items.findIndex((item) => sidebarListItemId(item) === key);
  const strategy = createSidebarSortingStrategy({
    items,
    settledOrder: [],
    settledExpanded: false,
    groupByProject: true,
  });
  const args = {
    activeIndex: indexOf(activeKey),
    overIndex: indexOf(overKey),
    activeNodeRect: rects[indexOf(activeKey)]!,
    rects,
    index: 0,
  } satisfies Parameters<SortingStrategy>[0];
  return (key: string) => strategy({ ...args, index: indexOf(key) })!;
}
