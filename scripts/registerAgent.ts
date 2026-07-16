import "dotenv/config";
import { encodeFunctionData, parseEventLogs } from "viem";
import { identityRegistryAbi } from "../agent/src/lib/abi.js";
import { sendTaggedTransaction } from "../agent/src/lib/attribution.js";
import { publicClient } from "../agent/src/lib/celoClient.js";

const IDENTITY_REGISTRY_ADDRESS = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432" as const;
const CHAIN_ID = 42220;

function buildAgentRegistrationFile(agentId: bigint) {
  const record = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "ORYN",
    description:
      "Non-custodial autonomous treasury agent on Celo. Splits every incoming cUSD payment into owner-approved payouts and savings, executed onchain. The agent wallet can only trigger a pre-approved split; it can never withdraw or redirect funds.",
    services: [
      { name: "web", endpoint: "https://github.com/angelraph/ORYN" },
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

async function main() {
  // Step 1: mint the identity NFT (agentId assigned by the registry).
  const registerData = encodeFunctionData({ abi: identityRegistryAbi, functionName: "register", args: [] });
  const registerHash = await sendTaggedTransaction({ to: IDENTITY_REGISTRY_ADDRESS, data: registerData });
  console.log(`[register] tx: ${registerHash}`);

  const receipt = await publicClient.getTransactionReceipt({ hash: registerHash });
  const [registeredEvent] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: receipt.logs });
  if (!registeredEvent) throw new Error("Registered event not found in receipt");

  const agentId = registeredEvent.args.agentId;
  console.log(`[register] agentId: ${agentId}`);

  // Step 2: set the registration file now that we know our own agentId.
  const agentURI = buildAgentRegistrationFile(agentId);
  const setUriData = encodeFunctionData({
    abi: identityRegistryAbi,
    functionName: "setAgentURI",
    args: [agentId, agentURI],
  });
  const setUriHash = await sendTaggedTransaction({ to: IDENTITY_REGISTRY_ADDRESS, data: setUriData });
  console.log(`[setAgentURI] tx: ${setUriHash}`);

  console.log("\nAgentId:", agentId.toString());
  console.log("8004scan:", `https://8004scan.io/agents/celo/${agentId}`);
  console.log("Celoscan NFT:", `https://celoscan.io/nft/${IDENTITY_REGISTRY_ADDRESS}/${agentId}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
