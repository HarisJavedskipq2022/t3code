/**
 * Where a browser tab an agent asked to reveal should show. Floating previews on:
 * the floating player. Off: a right-panel tab, as for a device, except in sheet
 * layouts, where only a reveal the agent forced floats. A tab already in the panel
 * is brought forward only when the agent forced it.
 */
export function agentBrowserRevealTarget(input: {
  readonly inPanel: boolean;
  readonly forced: boolean;
  readonly autoShowFloatingPreview: boolean;
  readonly sheetLayout: boolean;
}): "activate" | "panel" | "floating" | null {
  if (input.inPanel) return input.forced ? "activate" : null;
  if (!input.autoShowFloatingPreview && !input.sheetLayout) return "panel";
  return input.autoShowFloatingPreview || input.forced ? "floating" : null;
}
