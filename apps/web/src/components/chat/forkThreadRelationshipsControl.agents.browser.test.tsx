import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import type { ReactElement, ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { act, render, type Screen } from "../../../test/render";

const state = vi.hoisted(() => ({
  stopWorkflowLabel: "environment-data:orchestration:stop-workflow",
  projection: null as unknown,
  projections: null as Map<string, unknown> | null,
  navigate: vi.fn(),
  shells: [] as unknown[],
  projects: [] as unknown[],
  configs: new Map<string, unknown>(),
  showTooltips: false,
  command: vi.fn().mockResolvedValue({ _tag: "Success" }),
  workflowCommand: vi.fn().mockResolvedValue({ _tag: "Success" }),
  toast: vi.fn(),
  confirmAndDeleteThread: vi.fn().mockResolvedValue({ _tag: "Success" }),
  canOperate: true,
  archived: { snapshots: [] as unknown[], error: null as string | null, isLoading: false },
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));
vi.mock(import("../../hooks/useThreadActions"), async (original) => ({
  ...(await original()),
  useThreadActions: (() => ({ confirmAndDeleteThread: state.confirmAndDeleteThread })) as never,
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => state.canOperate) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useThreadProjection: ((ref: ScopedThreadRef | null) =>
    ref === null
      ? undefined
      : {
          projection: state.projections
            ? state.projections.get(scopedThreadKey(ref))
            : state.projection,
        }) as never,
  useThreadRelationshipShells: ((ref: { readonly environmentId: string }) =>
    (state.shells as ReadonlyArray<{ readonly environmentId: string; readonly source: unknown }>)
      .filter((shell) => shell.environmentId === ref.environmentId)
      .map((shell) => shell.source)) as never,
  useProjects: (() => state.projects) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentProviders: (() =>
    new Map(
      [...state.configs].map(([id, config]) => [id, (config as { providers: unknown }).providers]),
    )) as never,
}));
vi.mock(import("../../lib/archivedThreadsState"), async (original) => ({
  ...(await original()),
  useArchivedThreadSnapshots: (() => state.archived) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: { label?: string }) =>
    command.label === state.stopWorkflowLabel ? state.workflowCommand : state.command) as never,
}));
vi.mock(import("../ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: state.toast } as never };
});
vi.mock(import("../../state/orchestration"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const granted = Atom.make(true);
  const stopWorkflow = actual.orchestrationEnvironment.stopWorkflow;
  return {
    ...actual,
    orchestrationEnvironment: Object.assign(Object.create(actual.orchestrationEnvironment), {
      stopWorkflow: Object.assign(Object.create(stopWorkflow), {
        label: state.stopWorkflowLabel,
        permissionAtom: () => granted,
      }),
    }),
  };
});
// Tooltip and hover card content renders inline so the suite can read every row's agent
// details across many states without hovering each row.
vi.mock(import("../ui/tooltip"), async () => {
  const { cloneElement } = await import("react");
  return {
    Tooltip: (({ children }: { children: ReactNode }) => children) as never,
    TooltipTrigger: (({ render, children }: { render: ReactElement; children: ReactNode }) =>
      cloneElement(render, {}, children)) as never,
    TooltipPopup: (({ children }: { children: ReactNode }) =>
      state.showTooltips ? <div role="tooltip">{children}</div> : null) as never,
  };
});

import { ThreadRelationshipsPanel } from "./ThreadRelationshipsControl";

// The mocked hooks read `state` while rendering; each test starts from these values.
function resetState() {
  state.shells = [];
  state.projects = [];
  state.configs.clear();
  state.showTooltips = false;
  state.navigate.mockClear();
  state.command.mockClear();
  state.workflowCommand.mockReset().mockResolvedValue({ _tag: "Success" });
  state.toast.mockClear();
  state.confirmAndDeleteThread.mockClear();
  state.canOperate = true;
  state.archived = { snapshots: [], error: null, isLoading: false };
  state.projection = null;
  state.projections = null;
}

const panel = () => (
  <ThreadRelationshipsPanel
    environmentId={EnvironmentId.make("remote")}
    threadId={ThreadId.make("lead")}
  />
);
const click = (element: HTMLElement) => act(() => element.click());
const buttons = (screen: Screen) => [...screen.container.querySelectorAll("button")];
const allByLabel = (screen: Screen, label: string) =>
  buttons(screen).filter((button) => button.getAttribute("aria-label") === label);
function byLabel(screen: Screen, label: string) {
  const matches = allByLabel(screen, label);
  if (matches.length !== 1)
    throw new Error(`Expected one "${label}" button, got ${matches.length}`);
  return matches[0]!;
}
const sectionToggles = (screen: Screen, expanded: boolean) =>
  buttons(screen).filter(
    (button) =>
      button.getAttribute("aria-expanded") === String(expanded) &&
      !button.hasAttribute("aria-label"),
  );

it("does not offer to delete a stopped child thread without thread permission", async () => {
  resetState();
  state.canOperate = false;
  state.projection = {
    thread: { id: "lead", lineage: { relationshipToParent: null } },
    runs: [],
    providerThreads: [],
    providerSessions: [],
    contextTransfers: [],
    subagents: [
      {
        id: "sidekick",
        driver: "opencode",
        origin: "app_owned",
        status: "failed",
        providerInstanceId: "opencode",
        childThreadId: "sidekick-chat",
        title: "Ticket worker",
        startedAt: DateTime.makeUnsafe("2026-10-15T19:43:00Z"),
        completedAt: null,
        updatedAt: DateTime.makeUnsafe("2026-10-15T19:43:00Z"),
      },
    ],
  };
  state.shells = [
    {
      environmentId: "remote",
      source: {
        id: "sidekick-chat",
        title: "Ticket worker",
        lineage: { parentThreadId: "lead", relationshipToParent: "subagent" },
        status: "failed",
      },
    },
  ];
  await using screen = await render(panel(), { router: false });
  const [previousAgents] = sectionToggles(screen, false);
  if (previousAgents) await click(previousAgents);
  expect(allByLabel(screen, "Delete thread Ticket worker")).toHaveLength(0);
});

it("drops a deleted child agent's row only once the archive shows its thread is gone", async () => {
  resetState();
  const agent = {
    driver: "opencode",
    origin: "app_owned",
    providerInstanceId: "opencode",
    startedAt: DateTime.makeUnsafe("2026-10-15T19:43:00Z"),
    completedAt: null,
    updatedAt: DateTime.makeUnsafe("2026-10-15T19:43:00Z"),
  };
  state.projection = {
    thread: { id: "lead", lineage: { relationshipToParent: null } },
    runs: [],
    providerThreads: [],
    providerSessions: [],
    contextTransfers: [],
    subagents: [
      {
        ...agent,
        id: "sidekick",
        status: "failed",
        childThreadId: "sidekick-chat",
        title: "Ticket worker",
      },
      {
        ...agent,
        id: "reviewer",
        status: "completed",
        childThreadId: "reviewer-chat",
        title: "Reviewer",
      },
    ],
  };
  const childShell = (id: string, title: string, status: string) => ({
    environmentId: "remote",
    source: {
      id,
      title,
      lineage: { parentThreadId: "lead", relationshipToParent: "subagent" },
      status,
    },
  });
  const reviewerShell = childShell("reviewer-chat", "Reviewer", "completed");
  state.shells = [childShell("sidekick-chat", "Ticket worker", "failed"), reviewerShell];
  // The archive has not loaded yet.
  state.archived = { snapshots: [], error: null, isLoading: true };
  await using screen = await render(panel(), { router: false });
  await click(sectionToggles(screen, false)[0]!);
  const rowText = () =>
    [...screen.container.querySelectorAll("li")].map((row) => row.textContent ?? "");
  expect(rowText()).toHaveLength(2);

  state.confirmAndDeleteThread.mockImplementationOnce(async () => {
    state.shells = [reviewerShell];
    return { _tag: "Success" };
  });
  await click(byLabel(screen, "Delete thread Ticket worker"));
  await screen.rerender(panel());
  // Without the archive, a thread with no shell may be archived rather than deleted.
  expect(rowText()).toHaveLength(2);
  expect(rowText().some((text) => text.includes("Ticket worker"))).toBe(true);

  state.archived = { snapshots: [], error: "Failed to load archived threads.", isLoading: false };
  await screen.rerender(panel());
  expect(rowText()).toHaveLength(2);

  state.archived = {
    snapshots: [{ environmentId: "remote", snapshot: { threads: [] } }],
    error: null,
    isLoading: false,
  };
  await screen.rerender(panel());
  expect(rowText()).toHaveLength(1);
  expect(rowText()[0]).toContain("Reviewer");

  // Refreshing the archive keeps its snapshot, so the deleted row stays gone.
  state.archived = { ...state.archived, isLoading: true };
  await screen.rerender(panel());
  expect(rowText()).toHaveLength(1);
});
