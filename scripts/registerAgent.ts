import "dotenv/config";
import { encodeFunctionData, parseEventLogs } from "viem";
import { identityRegistryAbi } from "../agent/src/lib/abi.js";
import { sendTaggedTransaction } from "../agent/src/lib/attribution.js";
import { IDENTITY_REGISTRY_ADDRESS, buildAgentRegistrationFile } from "./agentRegistration.js";

async function main() {
  // Step 1: mint the identity NFT (agentId assigned by the registry).
  const registerData = encodeFunctionData({ abi: identityRegistryAbi, functionName: "register", args: [] });
  const registerReceipt = await sendTaggedTransaction({ to: IDENTITY_REGISTRY_ADDRESS, data: registerData });
  console.log(`[register] tx: ${registerReceipt.transactionHash}`);

  const [registeredEvent] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: registerReceipt.logs });
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
  const setUriReceipt = await sendTaggedTransaction({ to: IDENTITY_REGISTRY_ADDRESS, data: setUriData });
  console.log(`[setAgentURI] tx: ${setUriReceipt.transactionHash}`);

  console.log("\nAgentId:", agentId.toString());
  console.log("8004scan:", `https://8004scan.io/agents/celo/${agentId}`);
  console.log("Celoscan NFT:", `https://celoscan.io/nft/${IDENTITY_REGISTRY_ADDRESS}/${agentId}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
