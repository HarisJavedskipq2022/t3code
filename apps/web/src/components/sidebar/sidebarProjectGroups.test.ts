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
  groupByFirstAppearance,
  insertProjectGroupHeaders,
  parseProjectGroupMarker,
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
    let top = 0;
    const rects = items.map((item) => {
      const height =
        item.kind === "thread" ? 82 : item.marker.startsWith("project-group:") ? 28 : 0;
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
      activeIndex: indexOf("a2"),
      overIndex: indexOf("a1"),
      activeNodeRect: rects[indexOf("a2")]!,
      rects,
      index: 0,
    } satisfies Parameters<SortingStrategy>[0];

    // Project B is untouched, so its row's shift is the baseline for everything that stays put.
    const baseline = strategy({ ...args, index: indexOf("b1") })!.y;
    for (const [index, item] of items.entries()) {
      if (item.kind !== "marker" || parseProjectGroupMarker(item.marker) === null) continue;
      expect(strategy({ ...args, index })).toMatchObject({ y: baseline, scaleY: 1 });
    }
    // a1 slides down one card to make room for a2 above it.
    expect(strategy({ ...args, index: indexOf("a1") })).toMatchObject({
      y: baseline + 83,
      scaleY: 1,
    });
  });
});
