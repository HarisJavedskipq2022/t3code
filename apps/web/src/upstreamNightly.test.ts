import { describe, expect, it } from "vite-plus/test";

import { newerUpstreamNightly } from "./upstreamNightly";

describe("newerUpstreamNightly", () => {
  const current = "0.0.46-nightly.20261013.3053";

  it("picks the newest nightly ahead of the running build", () => {
    expect(
      newerUpstreamNightly(current, [
        "v0.0.46-nightly.20261013.3042",
        "v0.0.46-nightly.20261014.3060",
        "v0.0.46-nightly.20261013.3058",
        "v0.0.45",
      ]),
    ).toBe("v0.0.46-nightly.20261014.3060");
  });

  it("orders by version before date, so a new base version wins", () => {
    expect(
      newerUpstreamNightly(current, [
        "v0.0.46-nightly.20261020.3100",
        "v0.0.47-nightly.20261015.3070",
      ]),
    ).toBe("v0.0.47-nightly.20261015.3070");
  });

  it("is null when the build is current, ahead, or not a nightly", () => {
    expect(newerUpstreamNightly(current, ["v0.0.46-nightly.20261013.3053"])).toBeNull();
    expect(newerUpstreamNightly(current, ["v0.0.46-nightly.20261012.3035", "v0.0.45"])).toBeNull();
    expect(newerUpstreamNightly("0.0.0-dev", ["v0.0.46-nightly.20261014.3060"])).toBeNull();
  });
});
