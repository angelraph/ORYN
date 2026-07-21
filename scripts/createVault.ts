import "dotenv/config";
import { encodeFunctionData, parseEventLogs } from "viem";
import { factoryAbi } from "../agent/src/lib/abi.js";
import { sendTaggedTransaction } from "../agent/src/lib/attribution.js";
import { agentAccount } from "../agent/src/lib/celoClient.js";

const FACTORY_ADDRESS = process.env.VAULT_FACTORY_ADDRESS as `0x${string}` | undefined;
const CUSD_ADDRESS = process.env.CUSD_ADDRESS as `0x${string}`;

const OWNER_ADDRESS = process.argv[2] as `0x${string}` | undefined;

if (!FACTORY_ADDRESS) throw new Error("VAULT_FACTORY_ADDRESS is not set in .env");
if (!OWNER_ADDRESS) throw new Error("Usage: tsx scripts/createVault.ts <ownerAddress>");

async function main() {
  const data = encodeFunctionData({
    abi: factoryAbi,
    functionName: "createVaultFor",
    args: [OWNER_ADDRESS!, CUSD_ADDRESS, agentAccount.address],
  });

  const receipt = await sendTaggedTransaction({ to: FACTORY_ADDRESS!, data });
  console.log(`[createVault] tx: ${receipt.transactionHash}`);

  const [event] = parseEventLogs({ abi: factoryAbi, eventName: "VaultCreated", logs: receipt.logs });
  if (!event) throw new Error("VaultCreated event not found in receipt");

  console.log(`[createVault] owner: ${event.args.owner}`);
  console.log(`[createVault] vault: ${event.args.vault}`);
  console.log(`[createVault] agent: ${event.args.agent}`);
  console.log(`\nCeloscan: https://celoscan.io/address/${event.args.vault}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
