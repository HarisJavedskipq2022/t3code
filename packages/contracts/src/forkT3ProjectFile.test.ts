import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { T3ProjectFile, type T3ProjectFile as T3ProjectFileType } from "./t3ProjectFile.ts";

const decode = Schema.decodeUnknownSync(T3ProjectFile as never) as (
  input: unknown,
) => T3ProjectFileType;

describe("T3ProjectFile services", () => {
  it("decodes a marked service and rejects an invalid base port", () => {
    const decoded = decode({
      scripts: [
        {
          name: "Dev",
          command: "pnpm dev",
          icon: "play",
          service: true,
          servicePort: 5733,
        },
      ],
    });
    expect(decoded.scripts?.[0]).toEqual({
      name: "Dev",
      command: "pnpm dev",
      icon: "play",
      service: true,
      servicePort: 5733,
    });
    expect(decode({ scripts: [{ name: "Dev", command: "pnpm dev", service: true }] })).toEqual({
      scripts: [{ name: "Dev", command: "pnpm dev", service: true }],
    });
    for (const servicePort of [0, -1, 65536, 3000.5]) {
      expect(() =>
        decode({ scripts: [{ name: "Dev", command: "pnpm dev", service: true, servicePort }] }),
      ).toThrow();
    }
  });
});
