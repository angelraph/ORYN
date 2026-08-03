import "dotenv/config";
import { publicClient } from "../agent/src/lib/celoClient.js";
import { factoryAbi } from "../agent/src/lib/abi.js";

// Read-only diagnostic: for every known vault, checks whether it has an owner-configured
// split (ruleCount) and whether it has pendingBalance sitting undistributed. A vault with
// ruleCount == 0 will still let distribute() succeed (no revert), but the for-loop over
// rules never runs, so no Distributed event fires — which means the watcher's automatic
// distribute() call is a tagged tx with zero downstream x402 categorize() calls. That's a
// silent, structural cause of tagged_txs outpacing x402_settlements, separate from any
// x402 facilitator failure.
const vaultAbi = [
  {
    type: "function",
    name: "pendingBalance",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ruleCount",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalDeposited",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalDistributed",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const FACTORY_ADDRESS = process.env.VAULT_FACTORY_ADDRESS as `0x${string}` | undefined;

if (!FACTORY_ADDRESS) {
  throw new Error("VAULT_FACTORY_ADDRESS is not set in .env");
}

async function main() {
  const count = await publicClient.readContract({
    address: FACTORY_ADDRESS!,
    abi: factoryAbi,
    functionName: "vaultCount",
  });

  console.log(`[checkDistributionGap] ${count} vault(s) registered on factory ${FACTORY_ADDRESS}\n`);

  let noRules = 0;
  let stuckPending = 0; // has rules, but pendingBalance > 0 right now (mid-flight or watcher hasn't caught up)
  let clean = 0; // has rules, pendingBalance == 0 (fully distributed as of this read)

  for (let i = 0n; i < count; i++) {
    const vault = await publicClient.readContract({
      address: FACTORY_ADDRESS!,
      abi: factoryAbi,
      functionName: "allVaults",
      args: [i],
    });

    const [owner, pendingBalance, ruleCount, totalDeposited, totalDistributed] = await Promise.all([
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "owner" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "pendingBalance" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "ruleCount" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalDeposited" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalDistributed" }),
    ]);

    const flags: string[] = [];
    if (ruleCount === 0n) {
      flags.push("NO RULES SET — deposits here can never produce a Distributed event / x402 call");
      noRules++;
    } else if (pendingBalance > 0n) {
      flags.push("pendingBalance > 0 — awaiting next distribute()");
      stuckPending++;
    } else {
      clean++;
    }

    console.log(
      `vault ${vault} | owner ${owner} | rules ${ruleCount} | pending ${pendingBalance} | ` +
        `deposited ${totalDeposited} | distributed ${totalDistributed}${flags.length ? " | " + flags.join("; ") : ""}`,
    );
  }

  console.log(
    `\n[checkDistributionGap] summary: ${count} total — ${noRules} with no rules configured, ` +
      `${stuckPending} with pending balance awaiting distribution, ${clean} fully clean`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
