import { encodeFunctionData, parseEventLogs } from "viem";
import { vaultAbi } from "./lib/abi.js";
import { sendTaggedTransaction } from "./lib/attribution.js";
import { publicClient } from "./lib/celoClient.js";
import { errMsg } from "./lib/errors.js";
import { categorizeDistribution } from "../../x402-service/client.js";

/**
 * Triggers the owner's pre-approved split on a vault. This is the ONLY action the
 * agent wallet is authorized to take on a vault (see OrynVault.onlyAgentOrOwner) —
 * it cannot withdraw or redirect funds, only execute the rules the owner already set.
 *
 * After the split lands onchain, the agent pays its own categorization service via
 * x402 for each payout — a real pay-per-request settlement (Track 2), triggered by
 * real treasury activity (Track 1).
 */
export async function distributeVault(vaultAddress: `0x${string}`) {
  const data = encodeFunctionData({
    abi: vaultAbi,
    functionName: "distribute",
    args: [],
  });

  const hash = await sendTaggedTransaction({ to: vaultAddress, data });
  console.log(`[executor] distribute() on ${vaultAddress} -> ${hash}`);

  const receipt = await publicClient.getTransactionReceipt({ hash });
  const distributedEvents = parseEventLogs({ abi: vaultAbi, eventName: "Distributed", logs: receipt.logs });

  for (const event of distributedEvents) {
    try {
      const result = await categorizeDistribution({
        vault: vaultAddress,
        recipient: event.args.recipient,
        amount: event.args.amount.toString(),
      });
      console.log(`[executor] categorized payout to ${event.args.recipient}: ${result.category}`);
    } catch (err) {
      console.error(`[executor] x402 categorization failed for ${event.args.recipient}: ${errMsg(err)}`);
    }
  }

  return hash;
}
