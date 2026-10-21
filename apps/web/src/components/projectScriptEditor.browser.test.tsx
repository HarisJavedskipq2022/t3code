import { act, render, type Screen } from "../../test/render";
import { EnvironmentId, type ProjectScript } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));

import {
  editorRequestForScript,
  EMPTY_PROJECT_SCRIPT_INPUT,
  ProjectScriptEditorDialog,
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
  type ProjectScriptEditorRequest,
} from "./projectScriptEditor";

const onSubmit = vi.fn<Parameters<typeof ProjectScriptEditorDialog>[0]["onSubmit"]>();
const onClose = vi.fn();
const onDelete = vi.fn();

function request(name: string, error?: string): ProjectScriptEditorRequest {
  return {
    scriptId: name,
    initial: { ...EMPTY_PROJECT_SCRIPT_INPUT, name, command: `run-${name}` },
    ...(error === undefined ? {} : { error }),
  };
}

const open = (screen: Screen, nextRequest: ProjectScriptEditorRequest) =>
  screen.rerender(
    <StrictMode>
      <ProjectScriptEditorDialog
        environmentId={EnvironmentId.make("test")}
        request={nextRequest}
        scripts={[]}
        onSubmit={onSubmit}
        onClose={onClose}
        onDelete={onDelete}
      />
    </StrictMode>,
  );

const submit = () => document.querySelector("form")!.requestSubmit();
const messages = () => [...document.querySelectorAll("form p")].map((p) => p.textContent);
const saveButton = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!;

function deferredSave() {
  let resolve!: (result: ProjectScriptActionResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ProjectScriptActionResult>((resolveResult, rejectResult) => {
    resolve = resolveResult;
    reject = rejectResult;
  });
  return { promise, resolve, reject };
}

function setup() {
  onSubmit.mockReset();
  onClose.mockReset();
  onDelete.mockReset();
}

describe("project action editor save lifecycle", () => {
  it("does not close a replacement request or release its in-flight save", async () => {
    setup();
    await using screen = await render(null);
    const first = deferredSave();
    const second = deferredSave();
    onSubmit.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await open(screen, request("build"));
    await act(async () => submit());

    await open(screen, request("test"));
    expect(saveButton().disabled).toBe(false);
    expect(document.querySelector<HTMLInputElement>("#script-name")!.value).toBe("test");
    await act(async () => submit());

    await act(async () => first.resolve(AsyncResult.success(undefined)));
    expect(onClose).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(true);

    await act(async () => second.resolve(AsyncResult.success(undefined)));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls.map(([scriptId]) => scriptId)).toEqual(["build", "test"]);
  });
});

describe("project action editor services", () => {
  const serviceRequest = (initial: Partial<NewProjectScriptInput>): ProjectScriptEditorRequest => ({
    scriptId: "web",
    initial: { ...EMPTY_PROJECT_SCRIPT_INPUT, name: "Web", command: "pnpm dev", ...initial },
  });
  const servicePortInput = () => document.querySelector<HTMLInputElement>("#script-service-port")!;
  // React tracks input values itself, so a typed value goes through the native setter.
  const typeServicePort = (value: string) =>
    act(async () => {
      const input = servicePortInput();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("preserves service fields when opening the editor for a service action", () => {
    const script: ProjectScript = {
      id: "web",
      name: "Web",
      command: "pnpm dev",
      icon: "play",
      runOnWorktreeCreate: false,
      service: true,
      servicePort: 3000,
    };
    const opened = editorRequestForScript(script, []);
    expect(opened.initial.service).toBe(true);
    expect(opened.initial.servicePort).toBe(3000);
  });

  it("submits a service with its base port", async () => {
    setup();
    await using screen = await render(null);
    onSubmit.mockResolvedValue(AsyncResult.success(undefined));
    await open(screen, serviceRequest({}));
    // The id sits on the switch's hidden checkbox; people click the visible switch.
    const serviceSwitch = [...document.querySelectorAll<HTMLElement>('[role="switch"]')].find(
      (element) => element.closest("label")?.textContent?.includes("App service"),
    )!;
    await act(async () => serviceSwitch.click());
    await typeServicePort("3000");
    await act(async () => submit());
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      "web",
      expect.objectContaining({ service: true, servicePort: 3000 }),
    );
  });

  it("keeps an ordinary action free of service configuration", async () => {
    setup();
    await using screen = await render(null);
    onSubmit.mockResolvedValue(AsyncResult.success(undefined));
    await open(screen, request("test"));
    await act(async () => submit());
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      "test",
      expect.objectContaining({ service: false, servicePort: null }),
    );
  });

  it("rejects a service that also holds the setup or settle role", async () => {
    setup();
    await using screen = await render(null);
    await open(screen, serviceRequest({ service: true, runOnSettle: true }));
    await act(async () => submit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(messages().join(" ")).toContain("can't also");
  });

  it("rejects a base port outside 1..65535", async () => {
    setup();
    await using screen = await render(null);
    await open(screen, serviceRequest({ service: true, servicePort: 3000 }));
    await typeServicePort("70000");
    await act(async () => submit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(messages().join(" ")).toContain("between 1 and 65535");
  });
});
