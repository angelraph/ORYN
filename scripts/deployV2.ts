import "dotenv/config";
import { encodeDeployData, getAddress } from "viem";
import { readFileSync } from "node:fs";
import { publicClient, agentAccount } from "../agent/src/lib/celoClient.js";
import { sendTaggedTransaction, confirmTagged } from "../agent/src/lib/attribution.js";

// Deploys OrynVaultFactoryV2 to Celo mainnet through the same tagged funnel as every other ORYN
// transaction, so the deploy itself is attributed. Run `npx hardhat compile` first.
// Pass --dry-run to estimate gas and print the constructor args without sending.

export const TEXTILE_REACTOR = getAddress("0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3");

// Every v2 vault accepts these from day one (Ripio wFIAT that settles over x402, plus the
// dollar stablecoins the facilitator supports). wMXN/wPEN/wCLP can be added per vault later.
export const V2_TOKENS = {
  wARS: getAddress("0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D"),
  wBRL: getAddress("0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0"),
  wCOP: getAddress("0x8a1D45e102e886510e891d2Ec656a708991e2D76"),
  USAT: getAddress("0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771"),
  USDT: getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"),
  USDC: getAddress("0xcebA9300f2b948710d2653dD7B07f33A8B32118C"),
} as const;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const artifact = JSON.parse(
    readFileSync("artifacts/contracts/OrynVaultFactoryV2.sol/OrynVaultFactoryV2.json", "utf-8"),
  );
  const args = [TEXTILE_REACTOR, agentAccount.address, Object.values(V2_TOKENS)] as const;
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });

  console.log("deployer / default agent:", agentAccount.address);
  console.log("swap target (Textile reactor):", TEXTILE_REACTOR);
  console.log("accepted tokens:", V2_TOKENS);
  const gas = await publicClient.estimateGas({ account: agentAccount.address, data });
  console.log("estimated gas:", gas.toString());
  if (dryRun) return;

  // sendTaggedTransaction with no `to` deploys; the ERC-8021 suffix after the initcode is ignored
  // by the EVM but read by the attribution indexer.
  const receipt = await sendTaggedTransaction({ data });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deploy failed: ${receipt.transactionHash}`);
  console.log("OrynVaultFactoryV2:", receipt.contractAddress);
  console.log("tx:", receipt.transactionHash, "tagged:", await confirmTagged(receipt.transactionHash));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
