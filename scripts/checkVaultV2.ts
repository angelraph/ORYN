import "dotenv/config";
import { getAddress, parseAbiItem } from "viem";
import { publicClient } from "../agent/src/lib/celoClient.js";
import { factoryV2Abi, vaultV2Abi } from "../agent/src/lib/abiV2.js";
import { confirmTagged } from "../agent/src/lib/attribution.js";

// Read-only: a v2 vault's owner, split and links, plus whether its creation tx carried our tag.
// Usage: npx tsx scripts/checkVaultV2.ts <vault>
const vault = getAddress(process.argv[2]);
const factory = getAddress(process.env.ORYN_V2_FACTORY!);

const [owner, agent, legs, savingsBps, linkCount, count] = await Promise.all([
  publicClient.readContract({ address: vault, abi: vaultV2Abi, functionName: "owner" }),
  publicClient.readContract({ address: vault, abi: vaultV2Abi, functionName: "agent" }),
  publicClient.readContract({ address: vault, abi: vaultV2Abi, functionName: "getLegs" }),
  publicClient.readContract({ address: vault, abi: vaultV2Abi, functionName: "savingsBps" }),
  publicClient.readContract({ address: vault, abi: vaultV2Abi, functionName: "linkCount" }),
  publicClient.readContract({ address: factory, abi: factoryV2Abi, functionName: "vaultCount" }),
]);

const latest = await publicClient.getBlockNumber();
let createTx: `0x${string}` | undefined;
for (let to = latest; to > latest - 60_000n && !createTx; to -= 5000n) {
  const logs = await publicClient.getLogs({
    address: factory,
    event: parseAbiItem("event VaultCreated(address indexed owner, address indexed vault, address agent)"),
    args: { vault },
    fromBlock: to - 4999n,
    toBlock: to,
  });
  createTx = logs[0]?.transactionHash;
}

console.log({ vault, owner, agent, legs, savingsBps, linkCount, factoryVaultCount: count, createTx });
if (createTx) console.log("creation tx tagged:", await confirmTagged(createTx));
