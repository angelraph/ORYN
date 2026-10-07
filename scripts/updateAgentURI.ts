import "dotenv/config";
import { encodeFunctionData } from "viem";
import { identityRegistryAbi } from "../agent/src/lib/abi.js";
import { publicClient, agentAccount as account } from "../agent/src/lib/celoClient.js";
import { sendTaggedTransaction } from "../agent/src/lib/attribution.js";
import { IDENTITY_REGISTRY_ADDRESS, buildAgentRegistrationFile, decodeAgentURI } from "./agentRegistration.js";

// Re-publishes the ERC-8004 registration file for the EXISTING agent (AGENT_ID). Unlike
// registerAgent.ts this never mints; it only calls setAgentURI, and only if the record
// actually changed. Pass --dry-run to print the diff without sending.
const readAbi = [
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
] as const;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!process.env.AGENT_ID) throw new Error("AGENT_ID is not set in .env");
  const agentId = BigInt(process.env.AGENT_ID);

  const owner = await publicClient.readContract({ address: IDENTITY_REGISTRY_ADDRESS, abi: readAbi, functionName: "ownerOf", args: [agentId] });
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`agentId ${agentId} is owned by ${owner}, not this wallet (${account.address})`);
  }

  const current = await publicClient.readContract({ address: IDENTITY_REGISTRY_ADDRESS, abi: readAbi, functionName: "tokenURI", args: [agentId] });
  const next = buildAgentRegistrationFile(agentId);
  console.log("current:", decodeAgentURI(current));
  console.log("next:   ", decodeAgentURI(next));
  if (current === next) {
    console.log("\nOnchain record already up to date, nothing to send.");
    return;
  }

  const data = encodeFunctionData({ abi: identityRegistryAbi, functionName: "setAgentURI", args: [agentId, next] });
  // Simulate first so a revert costs nothing.
  await publicClient.call({ account: account.address, to: IDENTITY_REGISTRY_ADDRESS, data });
  if (dryRun) {
    console.log("\n--dry-run: simulation passed, not sending.");
    return;
  }

  const receipt = await sendTaggedTransaction({ to: IDENTITY_REGISTRY_ADDRESS, data });
  if (receipt.status !== "success") throw new Error(`setAgentURI reverted: ${receipt.transactionHash}`);
  console.log(`\n[setAgentURI] tx: ${receipt.transactionHash}`);

  // Read at the receipt's block: a load-balanced RPC can otherwise answer from a node
  // that hasn't seen this block yet and report a stale record.
  const after = await publicClient.readContract({
    address: IDENTITY_REGISTRY_ADDRESS, abi: readAbi, functionName: "tokenURI", args: [agentId], blockNumber: receipt.blockNumber,
  });
  console.log(after === next ? "verified: onchain record now matches." : "WARNING: onchain record does not match what was sent.");
  console.log("8004scan:", `https://8004scan.io/agents/celo/${agentId}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
