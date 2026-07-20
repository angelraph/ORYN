import "dotenv/config";
import { publicClient } from "./lib/celoClient.js";
import { factoryAbi, vaultAbi } from "./lib/abi.js";
import { distributeVault } from "./executor.js";
import { errMsg } from "./lib/errors.js";

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

// Reads the factory's own allVaults/vaultCount instead of scanning VaultCreated logs:
// eth_getLogs against public RPCs has shown silent, non-erroring gaps on wide historical
// ranges (confirmed live — a restart's log rescan missed a real vault entirely), which
// would permanently drop that vault from being watched. Contract reads don't have that
// failure mode.
async function discoverVaults() {
  const count = await publicClient.readContract({
    address: FACTORY_ADDRESS!,
    abi: factoryAbi,
    functionName: "vaultCount",
  });
  for (let i = BigInt(knownVaults.size); i < count; i++) {
    const vault = await publicClient.readContract({
      address: FACTORY_ADDRESS!,
      abi: factoryAbi,
      functionName: "allVaults",
      args: [i],
    });
    if (!knownVaults.has(vault)) {
      knownVaults.add(vault);
      console.log(`[watcher] discovered vault: ${vault}`);
    }
  }
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

      // The full-history rescan on every restart will re-see already-processed
      // deposits. Check pendingBalance first so those don't cost a pointless,
      // reverting transaction every time the agent restarts.
      const pending = await publicClient.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: "pendingBalance",
      });
      if (pending === 0n) {
        console.log(`[watcher] ${vault} already distributed, skipping`);
        continue;
      }

      try {
        await distributeVault(vault);
      } catch (err) {
        console.error(`[watcher] failed to distribute ${vault}: ${errMsg(err)}`);
      }
    }
  });
}

export async function runWatcher() {
  const currentBlock = await publicClient.getBlockNumber();
  console.log(
    `[watcher] catching up from deploy block ${FACTORY_DEPLOY_BLOCK} to ${currentBlock} (factory ${FACTORY_ADDRESS})`,
  );

  // Scan the full deposit history on every start (not just since last run) so a
  // restart after downtime never silently misses a deposit.
  await discoverVaults();
  await checkDeposits(FACTORY_DEPLOY_BLOCK!, currentBlock);

  let lastBlock = currentBlock;
  console.log(`[watcher] caught up, ${knownVaults.size} vault(s) known, polling every ${POLL_INTERVAL_MS}ms`);

  // A self-scheduling loop (not setInterval) so a slow RPC call can never overlap
  // with the next tick — that overlap previously caused distribute() to be called
  // twice for the same deposit (the second call safely reverted on-chain, but it's
  // wasted gas and log noise worth closing off structurally).
  async function poll() {
    try {
      const latest = await publicClient.getBlockNumber();
      if (latest > lastBlock) {
        const fromBlock = lastBlock + 1n;
        await discoverVaults();
        await checkDeposits(fromBlock, latest);
        lastBlock = latest;
      }
    } catch (err) {
      console.error(`[watcher] poll error: ${errMsg(err)}`);
    } finally {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  }

  setTimeout(poll, POLL_INTERVAL_MS);
}
