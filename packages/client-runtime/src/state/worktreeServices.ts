import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createWorktreeServicesEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    live: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:worktree-services:watch",
      tag: WS_METHODS.worktreeServicesWatch,
    }),
    control: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:worktree-services:control",
      tag: WS_METHODS.worktreeServicesControl,
    }),
  };
}

/** A bounded, inert log tail for surfaces without a terminal emulator. */
export function serviceLogText(text: string): string {
  return text
    .slice(-64_000)
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n/g, "\n");
}
