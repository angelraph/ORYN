import "dotenv/config";
import { toDataSuffix, verifyTx, type TxHash } from "@celo/attribution-tags";
import { concatHex, type Hex, type TransactionReceipt } from "viem";
import { publicClient, walletClient } from "./celoClient.js";

const ATTRIBUTION_TAG = process.env.ATTRIBUTION_TAG;

if (!ATTRIBUTION_TAG) {
  throw new Error("ATTRIBUTION_TAG is not set in .env — register at celobuilders.xyz first");
}

/**
 * The single funnel every ORYN transaction goes through. This is what makes ORYN's
 * activity show up on the hackathon leaderboard — skip this and the tx doesn't count,
 * no matter how real the payment is.
 */
export async function sendTaggedTransaction(params: {
  to: `0x${string}`;
  data?: Hex;
  value?: bigint;
  extraCodes?: string[];
}): Promise<TransactionReceipt> {
  const codes = params.extraCodes ? [...params.extraCodes, ATTRIBUTION_TAG!] : ATTRIBUTION_TAG!;
  const suffix = toDataSuffix(codes);
  const baseData = params.data ?? "0x";
  const taggedData = concatHex([baseData, suffix]);

  const hash = await walletClient.sendTransaction({
    to: params.to,
    data: taggedData,
    value: params.value ?? 0n,
  });

  // Return the receipt we already waited for instead of just the hash — callers
  // used to re-fetch it with a second, non-waiting getTransactionReceipt call,
  // which could race a lagging backend node behind the public RPC and throw
  // "not found" on a transaction that had, in fact, already succeeded.
  return publicClient.waitForTransactionReceipt({ hash });
}

/** Confirms a sent transaction actually carries our registered attribution tag. */
export async function confirmTagged(hash: TxHash): Promise<boolean> {
  const decoded = await verifyTx({ client: publicClient, hash });
  return decoded?.codes.includes(ATTRIBUTION_TAG!) ?? false;
}
