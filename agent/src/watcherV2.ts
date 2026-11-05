import "dotenv/config";
import { encodeFunctionData, getAddress, isAddress, parseEventLogs, type Address } from "viem";
import { publicClient } from "./lib/celoClient.js";
import { factoryV2Abi, vaultV2Abi } from "./lib/abiV2.js";
import { sendTaggedTransaction } from "./lib/attribution.js";
import { tokenByAddress } from "./lib/tokens.js";
import { errMsg } from "./lib/errors.js";

// ORYN v2 agent loop.
//
// v2 vaults are balance-based: x402 pay links settle as a plain token transfer straight into the
// vault, with no deposit() call and so no event of ORYN's own to watch. Instead, every tick reads
// pending(token) for every accepted token of every vault (one multicall), and splits whatever has
// arrived. Reading state rather than scanning logs also means a restart can never miss a payment.
//
// FX legs (a recipient paid in a different currency) are queued onchain by distribute(). Until a
// firm Textile quote path is wired in, the agent releases a queued leg in the currency that
// arrived once it has waited RELEASE_AFTER_MS, so nobody is ever left unpaid. The vault enforces
// that release can only go to the leg's own recipient.

const POLL_INTERVAL_MS = 15_000;
const RELEASE_AFTER_MS = Number(process.env.ORYN_V2_RELEASE_AFTER_MS ?? 10 * 60_000);

type VaultState = { tokens: Address[]; conversionsSeen: bigint; tokensReadAt: number };

const vaults = new Map<Address, VaultState>();
// conversion key -> first time the agent saw it still unsettled
const waitingConversions = new Map<string, number>();

function factoryAddress(): Address | null {
  const f = process.env.ORYN_V2_FACTORY;
  return f && isAddress(f) ? getAddress(f) : null;
}

async function discoverVaults(factory: Address) {
  const count = await publicClient.readContract({ address: factory, abi: factoryV2Abi, functionName: "vaultCount" });
  for (let i = BigInt(vaults.size); i < count; i++) {
    const vault = await publicClient.readContract({ address: factory, abi: factoryV2Abi, functionName: "allVaults", args: [i] });
    vaults.set(getAddress(vault), { tokens: [], conversionsSeen: 0n, tokensReadAt: 0 });
    console.log(`[watcher-v2] discovered vault: ${vault}`);
  }
}

async function refreshTokens(vault: Address, state: VaultState) {
  // An owner can add or remove currencies at any time; re-read the list every few minutes.
  if (Date.now() - state.tokensReadAt < 5 * 60_000) return;
  state.tokens = (await publicClient.readContract({ address: vault, abi: vaultV2Abi, functionName: "tokens" })).map((t) =>
    getAddress(t),
  );
  state.tokensReadAt = Date.now();
}

/** Every (vault, token) pair with enough pending to be worth a split, from one multicall. */
async function findPending(): Promise<{ vault: Address; token: Address; amount: bigint }[]> {
  const pairs: { vault: Address; token: Address }[] = [];
  for (const [vault, state] of vaults) for (const token of state.tokens) pairs.push({ vault, token });
  if (pairs.length === 0) return [];

  const results = await publicClient.multicall({
    contracts: pairs.map(({ vault, token }) => ({
      address: vault,
      abi: vaultV2Abi,
      functionName: "pending" as const,
      args: [token] as const,
    })),
    allowFailure: true,
  });

  const due: { vault: Address; token: Address; amount: bigint }[] = [];
  results.forEach((r, i) => {
    if (r.status !== "success") return;
    const amount = r.result as bigint;
    const info = tokenByAddress(pairs[i].token);
    const min = info?.minSplit ?? 1n;
    if (amount >= min) due.push({ ...pairs[i], amount });
  });
  return due;
}

async function distribute(vault: Address, token: Address, amount: bigint) {
  const symbol = tokenByAddress(token)?.symbol ?? token;
  console.log(`[watcher-v2] ${amount} ${symbol} pending on ${vault}, splitting`);
  const receipt = await sendTaggedTransaction({
    to: vault,
    data: encodeFunctionData({ abi: vaultV2Abi, functionName: "distribute", args: [token] }),
  });
  const paid = parseEventLogs({ abi: vaultV2Abi, eventName: "Paid", logs: receipt.logs });
  const queued = parseEventLogs({ abi: vaultV2Abi, eventName: "ConversionQueued", logs: receipt.logs });
  console.log(
    `[watcher-v2] distribute(${symbol}) on ${vault} -> ${receipt.transactionHash} (${paid.length} paid, ${queued.length} FX leg(s) queued)`,
  );
}

/** Releases queued FX legs that have waited long enough, in the currency that arrived. */
async function settleConversions(vault: Address, state: VaultState) {
  const count = await publicClient.readContract({ address: vault, abi: vaultV2Abi, functionName: "conversionCount" });
  for (let id = state.conversionsSeen; id < count; id++) {
    const [, , , amount] = await publicClient.readContract({
      address: vault,
      abi: vaultV2Abi,
      functionName: "conversions",
      args: [id],
    });
    const key = `${vault}:${id}`;
    if (amount === 0n) {
      waitingConversions.delete(key);
      // Only advance the cursor past a contiguous run of settled conversions.
      if (id === state.conversionsSeen) state.conversionsSeen = id + 1n;
      continue;
    }
    const firstSeen = waitingConversions.get(key) ?? Date.now();
    waitingConversions.set(key, firstSeen);
    if (Date.now() - firstSeen < RELEASE_AFTER_MS) continue;

    const receipt = await sendTaggedTransaction({
      to: vault,
      data: encodeFunctionData({ abi: vaultV2Abi, functionName: "releaseConversion", args: [id] }),
    });
    console.log(`[watcher-v2] released FX leg #${id} on ${vault} unconverted -> ${receipt.transactionHash}`);
    waitingConversions.delete(key);
  }
}

async function tick(factory: Address) {
  await discoverVaults(factory);
  for (const [vault, state] of vaults) {
    try {
      await refreshTokens(vault, state);
    } catch (err) {
      console.error(`[watcher-v2] couldn't read tokens of ${vault}: ${errMsg(err)}`);
    }
  }
  for (const { vault, token, amount } of await findPending()) {
    try {
      await distribute(vault, token, amount);
    } catch (err) {
      console.error(`[watcher-v2] failed to split ${token} on ${vault}: ${errMsg(err)}`);
    }
  }
  for (const [vault, state] of vaults) {
    try {
      await settleConversions(vault, state);
    } catch (err) {
      console.error(`[watcher-v2] conversion check failed on ${vault}: ${errMsg(err)}`);
    }
  }
}

export async function runWatcherV2() {
  const factory = factoryAddress();
  if (!factory) {
    console.log("[watcher-v2] ORYN_V2_FACTORY not set, v2 vaults are not being watched");
    return;
  }
  console.log(`[watcher-v2] watching v2 factory ${factory}, polling every ${POLL_INTERVAL_MS}ms`);

  // Self-scheduling (not setInterval) so a slow RPC call never overlaps the next tick and
  // double-sends distribute() for the same balance.
  async function poll() {
    try {
      await tick(factory!);
    } catch (err) {
      console.error(`[watcher-v2] poll error: ${errMsg(err)}`);
    } finally {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  }
  await poll();
}
