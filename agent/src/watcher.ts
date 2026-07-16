import "dotenv/config";
import { publicClient } from "./lib/celoClient.js";
import { factoryAbi, vaultAbi } from "./lib/abi.js";
import { distributeVault } from "./executor.js";

const FACTORY_ADDRESS = process.env.VAULT_FACTORY_ADDRESS as `0x${string}` | undefined;
const FACTORY_DEPLOY_BLOCK = process.env.VAULT_FACTORY_DEPLOY_BLOCK
  ? BigInt(process.env.VAULT_FACTORY_DEPLOY_BLOCK)
  : undefined;
const POLL_INTERVAL_MS = 15_000;
// forno.celo.org rejects eth_getLogs ranges wider than 5000 blocks.
const MAX_BLOCK_RANGE = 5000n;

if (!FACTORY_ADDRESS) {
  throw new Error("VAULT_FACTORY_ADDRESS is not set in .env — run `npm run deploy:mainnet` first");
}
if (FACTORY_DEPLOY_BLOCK === undefined) {
  throw new Error("VAULT_FACTORY_DEPLOY_BLOCK is not set in .env — see scripts/findDeployBlock.ts");
}

const knownVaults = new Set<`0x${string}`>();

/** Splits [fromBlock, toBlock] into <=MAX_BLOCK_RANGE windows and runs `fetch` over each. */
async function forEachChunk(
  fromBlock: bigint,
  toBlock: bigint,
  fetch: (from: bigint, to: bigint) => Promise<void>,
) {
  for (let from = fromBlock; from <= toBlock; from += MAX_BLOCK_RANGE) {
    const to = from + MAX_BLOCK_RANGE - 1n > toBlock ? toBlock : from + MAX_BLOCK_RANGE - 1n;
    await fetch(from, to);
  }
}

async function discoverVaults(fromBlock: bigint, toBlock: bigint) {
  await forEachChunk(fromBlock, toBlock, async (from, to) => {
    const logs = await publicClient.getContractEvents({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      eventName: "VaultCreated",
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const vault = log.args.vault;
      if (vault && !knownVaults.has(vault)) {
        knownVaults.add(vault);
        console.log(`[watcher] discovered vault: ${vault} (owner ${log.args.owner})`);
      }
    }
  });
}

async function checkDeposits(fromBlock: bigint, toBlock: bigint) {
  if (knownVaults.size === 0) return;

  await forEachChunk(fromBlock, toBlock, async (from, to) => {
    const logs = await publicClient.getContractEvents({
      address: Array.from(knownVaults),
      abi: vaultAbi,
      eventName: "Deposited",
      fromBlock: from,
      toBlock: to,
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
  });
}

export async function runWatcher() {
  const currentBlock = await publicClient.getBlockNumber();
  console.log(
    `[watcher] catching up from deploy block ${FACTORY_DEPLOY_BLOCK} to ${currentBlock} (factory ${FACTORY_ADDRESS})`,
  );

  // Scan the full history on every start (not just since last run) so a restart
  // after downtime never silently misses a vault or a deposit.
  await discoverVaults(FACTORY_DEPLOY_BLOCK!, currentBlock);
  await checkDeposits(FACTORY_DEPLOY_BLOCK!, currentBlock);

  let lastBlock = currentBlock;
  console.log(`[watcher] caught up, ${knownVaults.size} vault(s) known, polling every ${POLL_INTERVAL_MS}ms`);

  setInterval(async () => {
    try {
      const latest = await publicClient.getBlockNumber();
      if (latest <= lastBlock) return;

      const fromBlock = lastBlock + 1n;
      await discoverVaults(fromBlock, latest);
      await checkDeposits(fromBlock, latest);

      lastBlock = latest;
    } catch (err) {
      console.error("[watcher] poll error:", err);
    }
  }, POLL_INTERVAL_MS);
}
