import "dotenv/config";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;

if (!AGENT_PRIVATE_KEY) {
  throw new Error("AGENT_PRIVATE_KEY is not set in .env");
}

export const agentAccount = privateKeyToAccount(AGENT_PRIVATE_KEY);

export const publicClient = createPublicClient({
  chain: celo,
  transport: http(RPC_URL),
});

export const walletClient = createWalletClient({
  account: agentAccount,
  chain: celo,
  transport: http(RPC_URL),
});
