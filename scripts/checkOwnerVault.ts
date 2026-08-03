import "dotenv/config";
import { publicClient } from "../agent/src/lib/celoClient.js";
import { factoryAbi } from "../agent/src/lib/abi.js";

const vaultAbi = [
  { type: "function", name: "pendingBalance", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "savingsBalance", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "ruleCount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "getRule",
    inputs: [{ type: "uint256" }],
    outputs: [
      { type: "address", name: "recipient" },
      { type: "uint16", name: "bps" },
    ],
    stateMutability: "view",
  },
  { type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "totalDeposited", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalDistributed", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

const FACTORY_ADDRESS = process.env.VAULT_FACTORY_ADDRESS as `0x${string}`;
const OWNER = process.argv[2] as `0x${string}` | undefined;

if (!OWNER) throw new Error("Usage: tsx scripts/checkOwnerVault.ts <ownerAddress>");

async function main() {
  const vault = await publicClient.readContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "vaultOf",
    args: [OWNER!],
  });
  console.log("vault:", vault);
  if (/^0x0+$/.test(vault)) {
    console.log("no vault for this owner");
    return;
  }

  const [pending, savings, ruleCount, deposited, distributed] = await Promise.all([
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "pendingBalance" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "savingsBalance" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "ruleCount" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalDeposited" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalDistributed" }),
  ]);
  console.log({ pending, savings, ruleCount, deposited, distributed });

  for (let i = 0n; i < ruleCount; i++) {
    const rule = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "getRule", args: [i] });
    console.log(`rule[${i}]:`, rule);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
