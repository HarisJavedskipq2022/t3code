import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  AcpRegistryManagedBinaryUninstallInput,
  AcpRegistryManagedBinaryUninstallResult,
  officialAcpRegistryIconUrlForAgentId,
  resolveInlineAgentIcon,
  resolveOfficialAcpRegistryIconUrl,
} from "./acpRegistry.ts";

const decodeUninstallInput = Schema.decodeUnknownSync(AcpRegistryManagedBinaryUninstallInput);
const decodeUninstallResult = Schema.decodeUnknownSync(AcpRegistryManagedBinaryUninstallResult);

describe("ACP Registry contracts", () => {
  it("accepts only official Registry icon URLs and safe agent IDs", () => {
    expect(officialAcpRegistryIconUrlForAgentId("antigravity-acp")).toBe(
      "https://cdn.agentclientprotocol.com/registry/v1/latest/antigravity-acp.svg",
    );
    expect(officialAcpRegistryIconUrlForAgentId("../antigravity-acp")).toBeNull();
    expect(
      resolveOfficialAcpRegistryIconUrl(
        "https://cdn.agentclientprotocol.com/registry/v1/latest/pi-acp.svg",
      ),
    ).toBe("https://cdn.agentclientprotocol.com/registry/v1/latest/pi-acp.svg");
    expect(
      resolveOfficialAcpRegistryIconUrl(
        "https://cdn.agentclientprotocol.com.evil/registry/v1/latest/pi-acp.svg",
      ),
    ).toBeNull();
    expect(
      resolveOfficialAcpRegistryIconUrl(
        "https://user@cdn.agentclientprotocol.com/registry/v1/latest/pi-acp.svg",
      ),
    ).toBeNull();
  });

  it("accepts only bounded base64 image data URIs as inline agent icons", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(resolveInlineAgentIcon(png)).toBe(png);
    expect(resolveInlineAgentIcon("data:image/svg+xml;base64,PHN2Zz4=")).not.toBeNull();
    expect(resolveInlineAgentIcon("https://example.com/icon.png")).toBeNull();
    expect(resolveInlineAgentIcon("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(resolveInlineAgentIcon("data:image/svg+xml,<svg onload=alert(1)>")).toBeNull();
    expect(resolveInlineAgentIcon(`data:image/png;base64,${"A".repeat(8_192)}`)).toBeNull();
    expect(resolveInlineAgentIcon("")).toBeNull();
  });

  it("decodes managed binary uninstall payloads and rejects unsafe agent IDs", () => {
    expect(decodeUninstallInput({ agentId: "  example-agent  " })).toEqual({
      agentId: "example-agent",
    });
    expect(decodeUninstallResult({ agentId: "example-agent", removed: false })).toEqual({
      agentId: "example-agent",
      removed: false,
    });
    expect(() => decodeUninstallInput({ agentId: "../example-agent" })).toThrow();
  });
});
