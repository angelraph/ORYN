import "dotenv/config";
import { verifyTx } from "@celo/attribution-tags";
import { publicClient } from "../agent/src/lib/celoClient.js";

const hashes = process.argv.slice(2) as `0x${string}`[];

if (hashes.length === 0) {
  throw new Error("Usage: tsx scripts/verifyTags.ts <txHash> [txHash...]");
}

for (const hash of hashes) {
  const result = await verifyTx({ client: publicClient, hash });
  console.log(hash, "->", result);
}
