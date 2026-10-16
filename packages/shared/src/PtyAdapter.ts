import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class PtySpawnError extends Schema.TaggedError<PtySpawnError>()("PtySpawnError", {
  adapter: Schema.String,
  shell: Schema.optional(Schema.String),
  attemptedShells: Schema.optional(Schema.Array(Schema.String)),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    const shell = this.shell === undefined ? "" : ` '${this.shell}'`;
    const attemptedShells =
      this.attemptedShells === undefined || this.attemptedShells.length === 0
        ? ""
        : ` Tried shells: ${this.attemptedShells.join(", ")}.`;
    return `Failed to spawn PTY process${shell} with ${this.adapter}.${attemptedShells}`;
  }
}

export interface PtyExitEvent {
  exitCode: number;
  signal: number | null;
}

export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  /**
   * Whether the PTY's owned process group still has members, for a process
   * spawned with `signalProcessGroup`. Optional: an adapter without a group
   * concept omits it, and callers then rely on the shell exit alone.
   */
  isProcessGroupAlive?(): boolean;
  onData(callback: (data: string) => void): () => void;
  onExit(callback: (event: PtyExitEvent) => void): () => void;
}

export interface PtySpawnInput {
  shell: string;
  args?: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
  /**
   * Signal the PTY's own process group (the forkpty session leader and its
   * descendants) rather than only the shell PID. Set for command terminals so
   * a stop reaches the server a command spawned; ordinary interactive shells
   * leave it unset.
   */
  signalProcessGroup?: boolean;
}

export class PtyAdapter extends Context.Service<
  PtyAdapter,
  {
    readonly spawn: (input: PtySpawnInput) => Effect.Effect<PtyProcess, PtySpawnError>;
  }
>()("@t3tools/shared/PtyAdapter") {}
