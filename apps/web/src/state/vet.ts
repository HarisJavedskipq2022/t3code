import { createVetEnvironmentAtoms } from "@t3tools/client-runtime/state/vet";
import { connectionAtomRuntime } from "../connection/runtime";

export const vetEnvironment = createVetEnvironmentAtoms(connectionAtomRuntime);
