import type { KeybindingCommand } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { composerTakesShortcut } from "../chat/composerEventScope";
import {
  splitPaneShortcutOwnership,
  splitPaneTakesEvent,
  useSplitViewStore,
} from "./splitViewStore";

// The DOM SplitChatLayout renders: two panes, the second chat view marked as
// embedded, and the pane without the keyboard flagged unfocused.
function renderSplit(focused: "primary" | "secondary") {
  document.body.innerHTML = `
    <aside><button data-target="sidebar"></button></aside>
    <div data-split-pane="primary" ${focused === "primary" ? "" : "data-split-pane-unfocused"}>
      <form data-composer="primary"><textarea data-target="primary"></textarea></form>
    </div>
    <div data-split-pane="secondary" ${focused === "secondary" ? "" : "data-split-pane-unfocused"}>
      <div data-chat-embedded="thread-2">
        <form data-composer="secondary"><textarea data-target="secondary"></textarea></form>
      </div>
    </div>`;
  useSplitViewStore.setState({
    secondaryThreadKey: "env:thread-2",
    visible: true,
    focusedPane: focused,
  });
}

const target = (name: string) => document.querySelector(`[data-target="${name}"]`)!;
const composer = (pane: string) => document.querySelector(`[data-composer="${pane}"]`)!;

function keyFrom(name: string) {
  const event = new KeyboardEvent("keydown", { key: "k", bubbles: true });
  Object.defineProperty(event, "target", { value: target(name) });
  return event;
}

beforeEach(() => {
  useSplitViewStore.setState({ secondaryThreadKey: null, visible: false, focusedPane: "primary" });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("split view key ownership", () => {
  it("gives a key to the pane it was pressed in", () => {
    renderSplit("primary");
    const stop: KeybindingCommand = "thread.stop";
    const primary = splitPaneShortcutOwnership("primary", () => stop);
    const secondary = splitPaneShortcutOwnership("secondary", () => stop);

    expect(primary.claimsEvent!(keyFrom("primary"))).toBe(true);
    expect(secondary.claimsEvent!(keyFrom("primary"))).toBe(false);
    // Stopping from the second pane stops its own thread, never the route thread.
    expect(primary.claimsEvent!(keyFrom("secondary"))).toBe(false);
    expect(secondary.claimsEvent!(keyFrom("secondary"))).toBe(true);
    expect(secondary.runsCommand!(stop)).toBe(true);
  });

  it("sends panel keys from the second pane to the route thread", () => {
    renderSplit("secondary");
    const toggle: KeybindingCommand = "rightPanel.toggle";
    const primary = splitPaneShortcutOwnership("primary", () => toggle);
    const secondary = splitPaneShortcutOwnership("secondary", () => toggle);

    expect(primary.claimsEvent!(keyFrom("secondary"))).toBe(true);
    expect(secondary.runsCommand!(toggle)).toBe(false);
  });

  it("gives keys and pastes from outside both panes to the pane last clicked", () => {
    renderSplit("secondary");

    expect(splitPaneTakesEvent(keyFrom("sidebar"), "secondary")).toBe(true);
    expect(splitPaneTakesEvent(keyFrom("sidebar"), "primary")).toBe(false);
    expect(splitPaneTakesEvent(keyFrom("sidebar"), null)).toBe(true);
  });

  it("lets only one composer act on a stash or answer key", () => {
    renderSplit("primary");
    expect(composerTakesShortcut(target("sidebar"), composer("primary"))).toBe(true);
    expect(composerTakesShortcut(target("sidebar"), composer("secondary"))).toBe(false);

    renderSplit("secondary");
    expect(composerTakesShortcut(target("secondary"), composer("secondary"))).toBe(true);
    expect(composerTakesShortcut(target("secondary"), composer("primary"))).toBe(false);
    expect(composerTakesShortcut(target("sidebar"), composer("primary"))).toBe(false);
  });
});
