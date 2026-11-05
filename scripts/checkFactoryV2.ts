import "dotenv/config";
import { getAddress, parseAbi } from "viem";
import { publicClient } from "../agent/src/lib/celoClient.js";

// Read-only sanity check of a deployed OrynVaultFactoryV2: its config, and that its
// implementation is locked. Usage: npx tsx scripts/checkFactoryV2.ts <factory>
const factory = getAddress(process.argv[2] ?? process.env.ORYN_V2_FACTORY ?? "");
const abi = parseAbi([
  "function implementation() view returns (address)",
  "function swapTarget() view returns (address)",
  "function defaultAgent() view returns (address)",
  "function defaultTokens() view returns (address[])",
  "function vaultCount() view returns (uint256)",
]);
const read = (functionName: (typeof abi)[number]["name"]) => publicClient.readContract({ address: factory, abi, functionName } as never);

const [implementation, swapTarget, defaultAgent, defaultTokens, vaultCount] = await Promise.all(
  (["implementation", "swapTarget", "defaultAgent", "defaultTokens", "vaultCount"] as const).map(read),
);
const implOwner = await publicClient.readContract({
  address: implementation as `0x${string}`,
  abi: parseAbi(["function owner() view returns (address)"]),
  functionName: "owner",
});
console.log({ factory, implementation, implementationOwner: implOwner, swapTarget, defaultAgent, defaultTokens, vaultCount });
