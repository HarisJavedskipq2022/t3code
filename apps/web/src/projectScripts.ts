import {
  MAX_SCRIPT_ID_LENGTH,
  SCRIPT_RUN_COMMAND_PATTERN,
  type KeybindingCommand,
  type ProjectScript,
  type T3ProjectFileScript,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { NewProjectScriptInput } from "./components/projectScriptEditor";
const isScriptRunCommand = Schema.is(SCRIPT_RUN_COMMAND_PATTERN);

export interface ProjectScriptInput {
  readonly name: ProjectScript["name"];
  readonly command: ProjectScript["command"];
  readonly icon: ProjectScript["icon"];
  readonly runOnWorktreeCreate: ProjectScript["runOnWorktreeCreate"];
  readonly waitForSetup: boolean;
  readonly runOnSettle: boolean;
  readonly previewUrl: Exclude<ProjectScript["previewUrl"], undefined> | null;
  readonly autoOpenPreview: boolean;
  /** Marks the action as a long-running app service. Defaults to false. */
  readonly service?: boolean;
  /** Base port for the service; the worktree offset is added at runtime. */
  readonly servicePort?: number | null;
}

export function buildProjectScript(id: string, input: ProjectScriptInput): ProjectScript {
  return {
    id,
    name: input.name,
    command: input.command,
    icon: input.icon,
    runOnWorktreeCreate: input.runOnWorktreeCreate,
    ...(input.runOnWorktreeCreate && input.waitForSetup ? { async: false } : {}),
    ...(input.runOnSettle ? { runOnSettle: true } : {}),
    ...(input.previewUrl === null
      ? {}
      : {
          previewUrl: input.previewUrl,
          autoOpenPreview: input.autoOpenPreview,
        }),
    ...(input.service ? { service: true } : {}),
    ...(input.service && input.servicePort != null ? { servicePort: input.servicePort } : {}),
  };
}

/**
 * A service is a long-running action, so it cannot also hold the setup or
 * settle role. Returns the message to show when both are set, else null.
 */
export function projectScriptServiceConflict(input: {
  service?: boolean | undefined;
  runOnWorktreeCreate?: boolean | undefined;
  runOnSettle?: boolean | undefined;
}): string | null {
  if (input.service !== true) return null;
  if (input.runOnWorktreeCreate && input.runOnSettle) {
    return "An app service can't also be the setup and settle action. Turn off the service switch, or clear both roles.";
  }
  if (input.runOnWorktreeCreate) {
    return "An app service can't also be the setup action. Turn off the service switch, or clear 'Run automatically on worktree creation'.";
  }
  if (input.runOnSettle) {
    return "An app service can't also be the settle action. Turn off the service switch, or clear 'Run in the thread's worktree when the thread settles'.";
  }
  return null;
}

/**
 * Maps a script declared in `t3.json` to the action editor's input, preserving
 * every field the file declares. The caller owns the shortcut, which is not
 * part of the file.
 */
export function projectScriptInputFromFileScript(
  fileScript: T3ProjectFileScript,
): Omit<NewProjectScriptInput, "keybinding"> {
  return {
    name: fileScript.name,
    command: fileScript.command,
    icon: fileScript.icon ?? "play",
    runOnWorktreeCreate: fileScript.runOnWorktreeCreate ?? false,
    waitForSetup: fileScript.runOnWorktreeCreate === true && fileScript.async === false,
    runOnSettle: fileScript.runOnSettle ?? false,
    service: fileScript.service ?? false,
    servicePort: fileScript.servicePort ?? null,
    previewUrl: fileScript.previewUrl ?? null,
    autoOpenPreview: fileScript.previewUrl ? (fileScript.autoOpenPreview ?? false) : false,
  };
}

export function releaseClaimedRoles(
  script: ProjectScript,
  saved: ProjectScriptInput,
): ProjectScript {
  const releaseSetup = saved.runOnWorktreeCreate && script.runOnWorktreeCreate;
  const releaseSettle = saved.runOnSettle && script.runOnSettle === true;
  if (!releaseSetup && !releaseSettle) return script;
  return {
    ...script,
    ...(releaseSetup ? { runOnWorktreeCreate: false } : {}),
    ...(releaseSettle ? { runOnSettle: false } : {}),
  };
}

function normalizeScriptId(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) {
    return "script";
  }
  if (cleaned.length <= MAX_SCRIPT_ID_LENGTH) {
    return cleaned;
  }
  return cleaned.slice(0, MAX_SCRIPT_ID_LENGTH).replace(/-+$/g, "") || "script";
}

export function commandForProjectScript(scriptId: string): KeybindingCommand | null {
  const command = `script.${scriptId}.run`;
  return isScriptRunCommand(command) ? command : null;
}

export function projectScriptIdFromCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!isScriptRunCommand(trimmed)) {
    return null;
  }
  const [prefix, , suffix] = SCRIPT_RUN_COMMAND_PATTERN.parts;
  return trimmed.slice(prefix.literal.length, -suffix.literal.length);
}

export function nextProjectScriptId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds));
  const baseId = normalizeScriptId(name);
  if (!taken.has(baseId)) return baseId;

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseId}-${suffix}`;
    const safeCandidate =
      candidate.length <= MAX_SCRIPT_ID_LENGTH
        ? candidate
        : `${baseId.slice(0, Math.max(1, MAX_SCRIPT_ID_LENGTH - String(suffix).length - 1))}-${suffix}`;
    if (!taken.has(safeCandidate)) {
      return safeCandidate;
    }
    suffix += 1;
  }

  return `${baseId}-${Date.now()}`.slice(0, MAX_SCRIPT_ID_LENGTH);
}

export function primaryProjectScript(scripts: ReadonlyArray<ProjectScript>): ProjectScript | null {
  const regular = scripts.find((script) => !script.runOnWorktreeCreate && !script.runOnSettle);
  return regular ?? scripts.find((script) => !script.runOnSettle) ?? null;
}
