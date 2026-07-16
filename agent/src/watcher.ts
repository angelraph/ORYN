import "dotenv/config";
import { publicClient } from "./lib/celoClient.js";
import { factoryAbi, vaultAbi } from "./lib/abi.js";
import { distributeVault } from "./executor.js";

const FACTORY_ADDRESS = process.env.VAULT_FACTORY_ADDRESS as `0x${string}` | undefined;
const POLL_INTERVAL_MS = 15_000;

if (!FACTORY_ADDRESS) {
  throw new Error("VAULT_FACTORY_ADDRESS is not set in .env — run `npm run deploy:mainnet` first");
}

const knownVaults = new Set<`0x${string}`>();

async function discoverVaults(fromBlock: bigint, toBlock: bigint) {
  const logs = await publicClient.getContractEvents({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    eventName: "VaultCreated",
    fromBlock,
    toBlock,
  });
  for (const log of logs) {
    const vault = log.args.vault;
    if (vault && !knownVaults.has(vault)) {
      knownVaults.add(vault);
      console.log(`[watcher] discovered new vault: ${vault} (owner ${log.args.owner})`);
    }
  }
}

async function checkDeposits(fromBlock: bigint, toBlock: bigint) {
  if (knownVaults.size === 0) return;

  const logs = await publicClient.getContractEvents({
    address: Array.from(knownVaults),
    abi: vaultAbi,
    eventName: "Deposited",
    fromBlock,
    toBlock,
  });

  for (const log of logs) {
    const vault = log.address as `0x${string}`;
    console.log(`[watcher] deposit detected on ${vault}: from ${log.args.from}, amount ${log.args.amount}`);
    try {
      await distributeVault(vault);
    } catch (err) {
      console.error(`[watcher] failed to distribute ${vault}:`, err);
    }
  }
}

export async function runWatcher() {
  let lastBlock = await publicClient.getBlockNumber();
  console.log(`[watcher] starting at block ${lastBlock}, factory ${FACTORY_ADDRESS}`);

  // Seed with any vaults that already existed before the agent started.
  await discoverVaults(0n, lastBlock);

  setInterval(async () => {
    try {
      const currentBlock = await publicClient.getBlockNumber();
      if (currentBlock <= lastBlock) return;

      const fromBlock = lastBlock + 1n;
      await discoverVaults(fromBlock, currentBlock);
      await checkDeposits(fromBlock, currentBlock);

      lastBlock = currentBlock;
    } catch (err) {
      console.error("[watcher] poll error:", err);
    }
  }, POLL_INTERVAL_MS);
}
