import { MAX_SCRIPT_ID_LENGTH } from "@t3tools/contracts";
import { shortcutLabelForCommand } from "./keybindings";
import { describe, expect, it } from "vite-plus/test";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  projectScriptMenuLabel,
  settleProjectScript,
  setupProjectScript,
} from "@t3tools/shared/projectScripts";

import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
  primaryProjectScript,
  projectScriptIdFromCommand,
  projectScriptInputFromFileScript,
  projectScriptServiceConflict,
  releaseClaimedRoles,
} from "./projectScripts";

describe("projectScripts helpers", () => {
  it("builds scripts with preview settings", () => {
    expect(
      buildProjectScript("dev", {
        name: "Dev server",
        command: "pnpm dev",
        icon: "debug",
        runOnWorktreeCreate: false,
        waitForSetup: false,
        runOnSettle: false,
        previewUrl: "http://localhost:5733",
        autoOpenPreview: true,
      }),
    ).toEqual({
      id: "dev",
      name: "Dev server",
      command: "pnpm dev",
      icon: "debug",
      runOnWorktreeCreate: false,
      previewUrl: "http://localhost:5733",
      autoOpenPreview: true,
    });
  });

  it("omits preview settings when no preview URL is configured", () => {
    expect(
      buildProjectScript("test", {
        name: "Test",
        command: "pnpm test",
        icon: "test",
        runOnWorktreeCreate: false,
        waitForSetup: false,
        runOnSettle: false,
        previewUrl: null,
        autoOpenPreview: false,
      }),
    ).toEqual({
      id: "test",
      name: "Test",
      command: "pnpm test",
      icon: "test",
      runOnWorktreeCreate: false,
    });
  });

  it("only records async: false for setup scripts that should block the agent", () => {
    const input = {
      name: "Setup",
      command: "pnpm i",
      icon: "configure",
      previewUrl: null,
      autoOpenPreview: false,
      runOnSettle: false,
    } as const;
    expect(
      buildProjectScript("setup", { ...input, runOnWorktreeCreate: true, waitForSetup: true }),
    ).toMatchObject({ runOnWorktreeCreate: true, async: false });
    expect(
      buildProjectScript("setup", { ...input, runOnWorktreeCreate: true, waitForSetup: false }),
    ).not.toHaveProperty("async");
    expect(
      buildProjectScript("setup", { ...input, runOnWorktreeCreate: false, waitForSetup: true }),
    ).not.toHaveProperty("async");
  });

  it("builds and parses script run commands", () => {
    const command = commandForProjectScript("lint");
    expect(command).toBe("script.lint.run");
    expect(projectScriptIdFromCommand(command ?? "")).toBe("lint");
    expect(projectScriptIdFromCommand("terminal.toggle")).toBeNull();
  });

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

  it("preserves the exact ID at the shortcut length limit", () => {
    const id = "a".repeat(MAX_SCRIPT_ID_LENGTH);
    expect(projectScriptIdFromCommand(commandForProjectScript(id) ?? "")).toBe(id);
  });

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
    // Cleanup is never the one-click run button, even when it is all there is.
    expect(primaryProjectScript(scripts.filter((script) => script.id === "clean"))).toBeNull();
  });

  it("labels every lifecycle role a script runs in", () => {
    const script = {
      id: "both",
      name: "Both",
      command: "true",
      icon: "play" as const,
      runOnWorktreeCreate: true,
    };
    expect(projectScriptMenuLabel(script)).toBe("Both (setup)");
    expect(projectScriptMenuLabel({ ...script, runOnSettle: true })).toBe(
      "Both (setup, on settle)",
    );
    expect(projectScriptMenuLabel({ ...script, runOnWorktreeCreate: false })).toBe("Both");
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

  it("builds default runtime env for scripts", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      worktreePath: "/repo/worktree-a",
    });

    expect(env).toMatchObject({
      T3CODE_PROJECT_ROOT: "/repo",
      T3CODE_WORKTREE_PATH: "/repo/worktree-a",
    });
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

  it("allows overriding runtime env values", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      extraEnv: {
        T3CODE_PROJECT_ROOT: "/custom-root",
        CUSTOM_FLAG: "1",
      },
    });

    expect(env.T3CODE_PROJECT_ROOT).toBe("/custom-root");
    expect(env.CUSTOM_FLAG).toBe("1");
    expect(env.T3CODE_WORKTREE_PATH).toBeUndefined();
  });

  it("prefers the worktree path for script cwd resolution", () => {
    expect(
      projectScriptCwd({
        project: { cwd: "/repo" },
        worktreePath: "/repo/worktree-a",
      }),
    ).toBe("/repo/worktree-a");
    expect(
      projectScriptCwd({
        project: { cwd: "/repo" },
        worktreePath: null,
      }),
    ).toBe("/repo");
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
