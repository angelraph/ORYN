// Shared runtime for ORYN v2 pages (vault dashboard + pay page). ES module.
// Everything reads straight from Celo mainnet; the only off-chain piece is the x402 endpoint
// that turns a pay link into a gasless payment, and it holds no state of its own.

import {
  createPublicClient, createWalletClient, custom, fallback, http, parseAbi, encodeFunctionData,
  formatUnits, parseUnits, getAddress, isAddress, concatHex,
} from "https://esm.sh/viem@2.55.2";
import { celo } from "https://esm.sh/viem@2.55.2/chains";

// ---------------------------------------------------------------- deployment config
// Set once OrynVaultFactoryV2 is deployed (scripts/deployV2.ts prints it).
export const ORYN_V2_FACTORY = "0x229b68DbAC7d53497eAd2981f95d5dF2cE9fFA50";
// Public URL of x402-service (Railway). Serves GET/POST /pay/:vault/:linkId.
export const ORYN_API = "https://oryn-agent-production.up.railway.app";

/** True when the x402 service answers, so pages only offer gasless pay when it will work. */
export async function apiUp() {
  if (!ORYN_API) return false;
  try {
    const res = await fetch(`${ORYN_API}/health`, { signal: AbortSignal.timeout(6000) });
    return res.ok;
  } catch {
    return false;
  }
}
export const AGENT_ADDRESS = "0xeae6959bE76b5f2ad2142A6fe5E4Cf4F9Ca45d26";
export const ATTRIBUTION_TAG = "celo_4781ba9a079a";
// ERC-8021 suffix for ATTRIBUTION_TAG (same bytes as app.html / agent/src/lib/attribution.ts).
const ATTRIBUTION_SUFFIX = "0x63656c6f5f343738316261396130373961110080218021802180218021802180218021";
export const CELO_CHAIN_ID = 42220;

export function v2Live() { return isAddress(ORYN_V2_FACTORY); }

// Mirrors agent/src/lib/tokens.ts. `tone` picks a Celo brand accent for the currency chip.
export const TOKENS = [
  { symbol: "USAT", currency: "USD", flag: "🇺🇸", address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771", decimals: 6, tone: "sky" },
  { symbol: "USDC", currency: "USD", flag: "🇺🇸", address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6, tone: "sky" },
  { symbol: "USDT", currency: "USD", flag: "🇺🇸", address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6, tone: "jade" },
  { symbol: "wARS", currency: "ARS", flag: "🇦🇷", address: "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D", decimals: 18, tone: "lavender" },
  { symbol: "wBRL", currency: "BRL", flag: "🇧🇷", address: "0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0", decimals: 18, tone: "citrus" },
  { symbol: "wCOP", currency: "COP", flag: "🇨🇴", address: "0x8a1D45e102e886510e891d2Ec656a708991e2D76", decimals: 18, tone: "lotus" },
];
const BY_ADDR = new Map(TOKENS.map((t) => [t.address.toLowerCase(), t]));
export function tokenInfo(addr) {
  return BY_ADDR.get(String(addr).toLowerCase()) || { symbol: short(addr), currency: "", flag: "", address: addr, decimals: 18, tone: "sand" };
}

export const vaultAbi = parseAbi([
  "struct Leg { address recipient; uint16 bps; address payoutToken; }",
  "struct Link { address token; uint256 amount; uint32 period; bool active; string memo; }",
  "function factory() view returns (address)",
  "function owner() view returns (address)",
  "function agent() view returns (address)",
  "function tokens() view returns (address[])",
  "function pending(address) view returns (uint256)",
  "function held(address) view returns (uint256)",
  "function reserved(address) view returns (uint256)",
  "function savingsBps() view returns (uint16)",
  "function getLegs() view returns (Leg[])",
  "function linkCount() view returns (uint256)",
  "function getLink(uint256) view returns (Link)",
  "function setPolicy(Leg[] legs, uint16 savingsBps, address savingsToken)",
  "function createLink(address token, uint256 amount, uint32 period, string memo) returns (uint256)",
  "function setLinkActive(uint256 id, bool active)",
  "function withdraw(address token, uint256 amount, address to)",
  "function distribute(address token)",
  "event Split(address indexed token, uint256 amount)",
  "event Paid(address indexed token, address indexed recipient, uint256 amount)",
  "event Kept(address indexed token, uint256 savings, uint256 remainder)",
  "event Withdrawn(address indexed token, address indexed to, uint256 amount)",
  "event LinkCreated(uint256 indexed id, address indexed token, uint256 amount, uint32 period, string memo)",
]);
export const factoryAbi = parseAbi([
  "struct Leg { address recipient; uint16 bps; address payoutToken; }",
  "function vaultOf(address) view returns (address)",
  "function vaultCount() view returns (uint256)",
  "function createVault(Leg[] legs, uint16 savingsBps, address savingsToken, address[] capTokens, uint256[] caps) returns (address)",
]);
export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export const publicClient = createPublicClient({
  chain: celo,
  transport: fallback([http("https://forno.celo.org"), http("https://celo.drpc.org")]),
  batch: { multicall: true },
});

// ---------------------------------------------------------------- formatting
export function short(a) { a = String(a || ""); return a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-4) : a; }
export function fmt(amount, decimals, max = 2) {
  const n = Number(formatUnits(amount, decimals));
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 && n > 0 ? 6 : max });
}
export function fmtToken(amount, tokenAddr) { const t = tokenInfo(tokenAddr); return `${fmt(amount, t.decimals)} ${t.symbol}`; }
export const PERIODS = { 0: "One-off", 604800: "Weekly", 2592000: "Monthly" };
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
export { formatUnits, parseUnits, getAddress, isAddress };

// ---------------------------------------------------------------- wallet
let wallet = null;
export let account = null;

export async function connect() {
  if (!window.ethereum) throw new Error("No wallet found. Open this page in MiniPay, Valora or a browser with MetaMask.");
  const [addr] = await window.ethereum.request({ method: "eth_requestAccounts" });
  const chainHex = "0x" + CELO_CHAIN_ID.toString(16);
  const current = await window.ethereum.request({ method: "eth_chainId" });
  if (current !== chainHex) {
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    } catch (err) {
      if (err && err.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: chainHex, chainName: "Celo", nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 }, rpcUrls: ["https://forno.celo.org"], blockExplorerUrls: ["https://celoscan.io"] }],
        });
      } else throw err;
    }
  }
  account = getAddress(addr);
  wallet = createWalletClient({ account, chain: celo, transport: custom(window.ethereum) });
  return account;
}

export function onAccountChange(fn) {
  if (window.ethereum && window.ethereum.on) {
    window.ethereum.on("accountsChanged", (accs) => { account = accs[0] ? getAddress(accs[0]) : null; fn(account); });
  }
}

/** Sends a contract call from the connected wallet, tagged for attribution, and waits for it. */
export async function send({ to, abi, functionName, args }) {
  if (!wallet) throw new Error("Connect your wallet first.");
  const data = concatHex([encodeFunctionData({ abi, functionName, args }), ATTRIBUTION_SUFFIX]);
  const hash = await wallet.sendTransaction({ account, to, data, chain: celo });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw Object.assign(new Error("The transaction reverted onchain. Nothing moved except a little gas."), { hash });
  return { hash, receipt };
}

/** The x402 signer: the connected wallet signs; reads go to the public RPC. */
export function x402Signer() {
  if (!wallet) throw new Error("Connect your wallet first.");
  return {
    address: account,
    signTypedData: (msg) => wallet.signTypedData({ account, ...msg }),
    readContract: (args) => publicClient.readContract(args),
  };
}

export function cleanError(err) {
  let msg = (err && (err.shortMessage || err.message)) || String(err);
  if (/user rejected|user denied|rejected the request/i.test(msg)) return "You cancelled in your wallet. Nothing was sent.";
  if (/insufficient funds/i.test(msg)) return "Not enough CELO in your wallet for gas.";
  return msg.split("\n")[0];
}

// ---------------------------------------------------------------- reads
export async function vaultOf(owner) {
  if (!v2Live()) return null;
  const v = await publicClient.readContract({ address: ORYN_V2_FACTORY, abi: factoryAbi, functionName: "vaultOf", args: [owner] });
  return /^0x0{40}$/i.test(v) ? null : getAddress(v);
}

export async function readVault(vault) {
  const [owner, tokens, legs, savingsBps, linkCount] = await Promise.all([
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "owner" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "tokens" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "getLegs" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "savingsBps" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "linkCount" }),
  ]);
  const balances = await Promise.all(tokens.map(async (t) => {
    const [held, pending, reserved] = await Promise.all([
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "held", args: [t] }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "pending", args: [t] }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "reserved", args: [t] }),
    ]);
    return { token: getAddress(t), held, pending, reserved };
  }));
  const links = await Promise.all(Array.from({ length: Number(linkCount) }, (_, i) =>
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "getLink", args: [BigInt(i)] }).then((l) => ({ id: i, ...l }))));
  return { vault, owner: getAddress(owner), tokens, legs, savingsBps: Number(savingsBps), balances, links };
}

/** Recent split / payout / withdrawal events, newest first. forno caps getLogs at 5000 blocks. */
export async function recentActivity(vault, { blocks = 60_000n } = {}) {
  const latest = await publicClient.getBlockNumber();
  const start = latest > blocks ? latest - blocks : 0n;
  const out = [];
  for (let from = start; from <= latest; from += 5000n) {
    const to = from + 4999n > latest ? latest : from + 4999n;
    try {
      const logs = await publicClient.getContractEvents({ address: vault, abi: vaultAbi, fromBlock: from, toBlock: to });
      out.push(...logs.filter((l) => ["Split", "Paid", "Withdrawn", "LinkCreated"].includes(l.eventName)));
    } catch {}
  }
  return out.sort((a, b) => Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex);
}

// Shared links always point at the public domain, never at a preview or local origin.
export const SITE = "https://oryn.click";
export function payUrl(vault, id) {
  return `${SITE}/pay?v=${vault}&l=${id}`;
}
