import "dotenv/config";
import { webcrypto } from "node:crypto";
import { createPublicClient, createWalletClient, fallback, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

// @x402/evm's client needs the Web Crypto API on `globalThis.crypto`, which is only
// global by default on Node 19+. Railway's build has picked an older Node, so every
// x402 payment there failed with "Crypto API not available" (worked locally on newer
// Node, which is why this was invisible in dev) — polyfill it regardless of runtime.
if (!globalThis.crypto) {
  // @ts-expect-error -- Node's webcrypto matches the DOM Crypto interface x402 expects.
  globalThis.crypto = webcrypto;
}

const PRIMARY_RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
// forno.celo.org has shown intermittent timeouts; these back it up so a single
// provider's flakiness can't stall the whole agent. Verified live before use
// (eth_chainId == 0xa4ec) rather than assumed.
const FALLBACK_RPC_URLS = ["https://rpc.ankr.com/celo", "https://celo.drpc.org"];

const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;

if (!AGENT_PRIVATE_KEY) {
  throw new Error("AGENT_PRIVATE_KEY is not set in .env");
}

export const agentAccount = privateKeyToAccount(AGENT_PRIVATE_KEY);

const transport = fallback(
  [PRIMARY_RPC_URL, ...FALLBACK_RPC_URLS].map((url) =>
    http(url, { timeout: 20_000, retryCount: 2 }),
  ),
);

export const publicClient = createPublicClient({
  chain: celo,
  transport,
});

export const walletClient = createWalletClient({
  account: agentAccount,
  chain: celo,
  transport,
});
