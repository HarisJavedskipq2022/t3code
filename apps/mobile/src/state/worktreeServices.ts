import { createWorktreeServicesEnvironmentAtoms } from "@t3tools/client-runtime/state/worktreeServices";
import { connectionAtomRuntime } from "../connection/runtime";

export const worktreeServicesEnvironment =
  createWorktreeServicesEnvironmentAtoms(connectionAtomRuntime);
