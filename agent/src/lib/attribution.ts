import "dotenv/config";
import { toDataSuffix, verifyTx, type TxHash } from "@celo/attribution-tags";
import { concatHex, type Hex } from "viem";
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
}): Promise<TxHash> {
  const codes = params.extraCodes ? [...params.extraCodes, ATTRIBUTION_TAG!] : ATTRIBUTION_TAG!;
  const suffix = toDataSuffix(codes);
  const baseData = params.data ?? "0x";
  const taggedData = concatHex([baseData, suffix]);

  const hash = await walletClient.sendTransaction({
    to: params.to,
    data: taggedData,
    value: params.value ?? 0n,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Confirms a sent transaction actually carries our registered attribution tag. */
export async function confirmTagged(hash: TxHash): Promise<boolean> {
  const decoded = await verifyTx({ client: publicClient, hash });
  return decoded?.codes.includes(ATTRIBUTION_TAG!) ?? false;
}
