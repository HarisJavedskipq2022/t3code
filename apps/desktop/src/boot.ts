require("./compileCache.cjs");

// A fork build (scripts/build-desktop-artifact.ts, T3CODE_DESKTOP_FORK_*) bakes
// its own name, T3 home and Electron profile into the app's package.json. Applying
// them as env defaults before main loads keeps every reader of T3CODE_HOME
// consistent and leaves the official install's state alone.
{
  const NodeFS = require("node:fs") as typeof import("node:fs");
  const NodeOS = require("node:os") as typeof import("node:os");
  const NodePath = require("node:path") as typeof import("node:path");
  const { app } = require("electron") as typeof import("electron");
  const packageJson = JSON.parse(
    NodeFS.readFileSync(NodePath.join(app.getAppPath(), "package.json"), "utf8"),
  ) as {
    t3codeFork?: { home?: unknown; userDataName?: unknown; name?: unknown; syncScript?: unknown };
  };
  const fork = packageJson.t3codeFork;
  if (typeof fork?.home === "string" && !process.env.T3CODE_HOME?.trim()) {
    process.env.T3CODE_HOME = NodePath.join(NodeOS.homedir(), fork.home);
  }
  if (typeof fork?.userDataName === "string") {
    process.env.T3CODE_DESKTOP_USER_DATA_NAME = fork.userDataName;
  }
  if (typeof fork?.name === "string") {
    process.env.T3CODE_DESKTOP_APP_NAME = fork.name;
  }
  if (typeof fork?.syncScript === "string") {
    process.env.T3CODE_DESKTOP_FORK_SYNC_SCRIPT = fork.syncScript;
  }
}

require("./main.cjs");
