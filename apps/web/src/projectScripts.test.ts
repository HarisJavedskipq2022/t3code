import { shortcutLabelForCommand } from "./keybindings";
import { describe, expect, it } from "vite-plus/test";
import {
  projectScriptRuntimeEnv,
  settleProjectScript,
  setupProjectScript,
} from "@t3tools/shared/projectScripts";

import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
  primaryProjectScript,
  projectScriptInputFromFileScript,
  projectScriptServiceConflict,
  releaseClaimedRoles,
} from "./projectScripts";

describe("projectScripts helpers", () => {
  it.each(["install-javascript-dependencies", "A", "a.b", "a b", "-a", "", "a".repeat(25)])(
    "omits the shortcut for legacy script ID %j without crashing script menus",
    (id) => {
      const commands = ["lint", id, "test"].map(commandForProjectScript);
      expect(commands).toEqual(["script.lint.run", null, "script.test.run"]);
      expect(commands.map((command) => shortcutLabelForCommand([], command))).toEqual([
        null,
        null,
        null,
      ]);
    },
  );

  it("slugifies and dedupes project script ids", () => {
    expect(nextProjectScriptId("Run Tests", [])).toBe("run-tests");
    expect(nextProjectScriptId("Run Tests", ["run-tests"])).toBe("run-tests-2");
    expect(nextProjectScriptId("!!!", [])).toBe("script");
  });

  it("resolves primary, setup, and settle scripts", () => {
    const scripts = [
      {
        id: "setup",
        name: "Setup",
        command: "bun install",
        icon: "configure" as const,
        runOnWorktreeCreate: true,
      },
      {
        id: "clean",
        name: "Clean",
        command: "cargo clean",
        icon: "build" as const,
        runOnWorktreeCreate: false,
        runOnSettle: true,
      },
      {
        id: "test",
        name: "Test",
        command: "bun test",
        icon: "test" as const,
        runOnWorktreeCreate: false,
      },
    ];

    expect(primaryProjectScript(scripts)?.id).toBe("test");
    expect(setupProjectScript(scripts)?.id).toBe("setup");
    expect(settleProjectScript(scripts)?.id).toBe("clean");
    expect(primaryProjectScript(scripts.filter((script) => script.id === "clean"))).toBeNull();
  });

  it("moves the setup and settle roles to the script that claims them", () => {
    const input = {
      name: "Next",
      command: "true",
      icon: "play",
      waitForSetup: false,
      previewUrl: null,
      autoOpenPreview: false,
    } as const;
    const holder = {
      id: "holder",
      name: "Holder",
      command: "true",
      icon: "play" as const,
      runOnWorktreeCreate: true,
      runOnSettle: true,
    };

    expect(
      releaseClaimedRoles(holder, { ...input, runOnWorktreeCreate: false, runOnSettle: true }),
    ).toMatchObject({ runOnWorktreeCreate: true, runOnSettle: false });
    expect(
      releaseClaimedRoles(holder, { ...input, runOnWorktreeCreate: true, runOnSettle: false }),
    ).toMatchObject({ runOnWorktreeCreate: false, runOnSettle: true });
    expect(
      releaseClaimedRoles(holder, { ...input, runOnWorktreeCreate: false, runOnSettle: false }),
    ).toBe(holder);
  });

  it("gives each worktree a stable port offset and the project folder none", () => {
    const first = projectScriptRuntimeEnv({ project: { cwd: "/repo" }, worktreePath: "/wt/a" });
    const again = projectScriptRuntimeEnv({ project: { cwd: "/repo" }, worktreePath: "/wt/a" });
    const other = projectScriptRuntimeEnv({ project: { cwd: "/repo" }, worktreePath: "/wt/b" });
    const offset = Number(first.T3CODE_PORT_OFFSET);

    expect(offset).toBeGreaterThanOrEqual(1);
    expect(offset).toBeLessThanOrEqual(3000);
    expect(again.T3CODE_PORT_OFFSET).toBe(first.T3CODE_PORT_OFFSET);
    expect(other.T3CODE_PORT_OFFSET).not.toBe(first.T3CODE_PORT_OFFSET);
    expect(projectScriptRuntimeEnv({ project: { cwd: "/repo" } }).T3CODE_PORT_OFFSET).toBe("0");
  });
});

describe("project script services", () => {
  const base = {
    name: "Dev",
    command: "pnpm dev",
    icon: "play",
    runOnWorktreeCreate: false,
    waitForSetup: false,
    runOnSettle: false,
    previewUrl: null,
    autoOpenPreview: false,
  } as const;

  it("omits service fields for an ordinary action", () => {
    expect(buildProjectScript("dev", base)).toEqual({
      id: "dev",
      name: "Dev",
      command: "pnpm dev",
      icon: "play",
      runOnWorktreeCreate: false,
    });
  });

  it("marks a service with its base port", () => {
    expect(buildProjectScript("dev", { ...base, service: true, servicePort: 3000 })).toMatchObject({
      service: true,
      servicePort: 3000,
    });
  });

  it("marks a service that configures no port", () => {
    const script = buildProjectScript("dev", { ...base, service: true, servicePort: null });
    expect(script.service).toBe(true);
    expect(script).not.toHaveProperty("servicePort");
  });

  it("drops a base port when the action is not a service", () => {
    const script = buildProjectScript("dev", { ...base, service: false, servicePort: 3000 });
    expect(script).not.toHaveProperty("service");
    expect(script).not.toHaveProperty("servicePort");
  });

  it("rejects combining a service with the setup or settle role", () => {
    expect(projectScriptServiceConflict({ service: false, runOnSettle: true })).toBeNull();
    expect(projectScriptServiceConflict({ service: true })).toBeNull();
    expect(projectScriptServiceConflict({ service: true, runOnWorktreeCreate: true })).toContain(
      "setup action",
    );
    expect(projectScriptServiceConflict({ service: true, runOnSettle: true })).toContain(
      "settle action",
    );
    expect(
      projectScriptServiceConflict({ service: true, runOnWorktreeCreate: true, runOnSettle: true }),
    ).toContain("setup and settle");
  });

  it("preserves service fields when importing a t3.json action", () => {
    expect(
      projectScriptInputFromFileScript({
        name: "Web",
        command: "pnpm dev",
        service: true,
        servicePort: 5733,
      }),
    ).toEqual({
      name: "Web",
      command: "pnpm dev",
      icon: "play",
      runOnWorktreeCreate: false,
      waitForSetup: false,
      runOnSettle: false,
      service: true,
      servicePort: 5733,
      previewUrl: null,
      autoOpenPreview: false,
    });
  });

  it("preserves ordinary fields when importing a plain t3.json action", () => {
    expect(
      projectScriptInputFromFileScript({
        name: "Test",
        command: "vp test",
        icon: "test",
        runOnWorktreeCreate: true,
        async: false,
        previewUrl: "http://localhost:5173",
        autoOpenPreview: true,
      }),
    ).toEqual({
      name: "Test",
      command: "vp test",
      icon: "test",
      runOnWorktreeCreate: true,
      waitForSetup: true,
      runOnSettle: false,
      service: false,
      servicePort: null,
      previewUrl: "http://localhost:5173",
      autoOpenPreview: true,
    });
  });
});
