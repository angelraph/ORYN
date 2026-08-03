import "dotenv/config";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import vaultArtifact from "../artifacts/contracts/OrynVault.sol/OrynVault.json" with { type: "json" };

const VAULT_ADDRESS = (process.argv[2] ?? "0xc3c92EA811e5fF318E0D12384CdeD13BD3aEee0E") as `0x${string}`;

const client = createPublicClient({
  chain: celo,
  transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
});

const abi = vaultArtifact.abi;

async function main() {
  const [owner, agent, ruleCount, pendingBalance, savingsBalance, totalDeposited, totalDistributed] =
    await Promise.all([
      client.readContract({ address: VAULT_ADDRESS, abi, functionName: "owner" }),
      client.readContract({ address: VAULT_ADDRESS, abi, functionName: "agent" }),
      client.readContract({ address: VAULT_ADDRESS, abi, functionName: "ruleCount" }),
      client.readContract({ address: VAULT_ADDRESS, abi, functionName: "pendingBalance" }),
      client.readContract({ address: VAULT_ADDRESS, abi, functionName: "savingsBalance" }),
      client.readContract({ address: VAULT_ADDRESS, abi, functionName: "totalDeposited" }),
      client.readContract({ address: VAULT_ADDRESS, abi, functionName: "totalDistributed" }),
    ]);

  console.log(`Vault: ${VAULT_ADDRESS}`);
  console.log(`Owner: ${owner}`);
  console.log(`Agent: ${agent}`);
  console.log(`Pending balance (raw): ${pendingBalance}`);
  console.log(`Savings balance (raw): ${savingsBalance}`);
  console.log(`Total deposited (raw): ${totalDeposited}`);
  console.log(`Total distributed (raw): ${totalDistributed}`);
  console.log(`Rule count: ${ruleCount}`);

  const count = Number(ruleCount as bigint);
  for (let i = 0; i < count; i++) {
    const rule = (await client.readContract({
      address: VAULT_ADDRESS,
      abi,
      functionName: "getRule",
      args: [BigInt(i)],
    })) as [string, number];
    console.log(`  Rule ${i}: recipient=${rule[0]} bps=${rule[1]} (${(rule[1] / 100).toFixed(2)}%)`);
  }

  const totalBps = count === 0 ? 0 : undefined;
  if (count === 0) console.log("  (no rules set — 100% would stay as savings on every distribute())");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
