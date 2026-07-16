import "dotenv/config";
import { verifyTx } from "@celo/attribution-tags";
import { publicClient } from "../agent/src/lib/celoClient.js";

const hashes = [
  "0xca789f91786bed691ca946c03e7167df0157d5e0ae7b8532b0f0ecc0d6479611",
  "0x54d9d7d4be67a10a3da50d357615a02174beaef84da2a42a6533fc1296e7d39b",
] as const;

for (const hash of hashes) {
  const result = await verifyTx({ client: publicClient, hash });
  console.log(hash, "->", result);
}
