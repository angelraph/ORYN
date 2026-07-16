import { encodeFunctionData } from "viem";
import { vaultAbi } from "../agent/src/lib/abi.js";

const VAULT_ADDRESS = process.argv[2] as `0x${string}` | undefined;
const rulesArg = process.argv[3];

if (!VAULT_ADDRESS || !rulesArg) {
  throw new Error(
    'Usage: tsx scripts/buildSetRulesTx.ts <vaultAddress> \'[{"recipient":"0x...","bps":3000}]\'',
  );
}

const rules = JSON.parse(rulesArg) as { recipient: `0x${string}`; bps: number }[];

const data = encodeFunctionData({ abi: vaultAbi, functionName: "setRules", args: [rules] });

console.log("To:", VAULT_ADDRESS);
console.log("Data:", data);
console.log("Value: 0");
console.log("\nSign and send this from the vault OWNER wallet only.");
