// The ERC-8004 registration file for ORYN, shared by registerAgent.ts (first mint) and
// updateAgentURI.ts (later edits) so the onchain record can only ever come from one place.
export const IDENTITY_REGISTRY_ADDRESS = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432" as const;
export const CHAIN_ID = 42220;

export function buildAgentRegistrationFile(agentId: bigint): string {
  const record = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "ORYN",
    description:
      "Non-custodial autonomous treasury agent on Celo. Splits every incoming cUSD payment into owner-approved payouts and savings, executed onchain. The agent wallet can only trigger a pre-approved split; it can never withdraw or redirect funds.",
    image: "https://oryn.click/assets/oryn-mark.png",
    services: [
      { name: "web", endpoint: "https://oryn.click" },
      { name: "x402", endpoint: "https://api.x402.celo.org" },
    ],
    x402Support: true,
    active: true,
    registrations: [
      {
        agentId: Number(agentId),
        agentRegistry: `eip155:${CHAIN_ID}:${IDENTITY_REGISTRY_ADDRESS}`,
      },
    ],
    supportedTrust: ["reputation"],
  };
  const json = JSON.stringify(record);
  const base64 = Buffer.from(json, "utf-8").toString("base64");
  return `data:application/json;base64,${base64}`;
}

export function decodeAgentURI(uri: string): string {
  return uri.startsWith("data:application/json;base64,") ? Buffer.from(uri.split(",")[1], "base64").toString("utf-8") : uri;
}
