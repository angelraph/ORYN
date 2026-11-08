#!/usr/bin/env node
// ORYN MCP server: lets any AI agent (Claude, Cursor, any MCP client) read ORYN vaults, create
// pay links, and pay ORYN pay links over x402 on Celo mainnet, by itself.
//
// Read tools need no keys. Writing needs one of:
//   ORYN_PAYER_PRIVATE_KEY  a wallet holding USA₮ that pays links (it only signs; Celo's
//                           facilitator settles and pays the gas)
//   ORYN_OWNER_PRIVATE_KEY  the vault owner's key, to create pay links (a tagged tx, a few cents of CELO)
// Keys stay on the machine running this server; nothing is sent anywhere except signatures.
//
// Run: npx tsx mcp/server.ts   (stdio transport)
import "dotenv/config";
import { webcrypto } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { concatHex, createPublicClient, createWalletClient, encodeFunctionData, fallback, formatUnits, getAddress, http, isAddress, parseAbi, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { toDataSuffix } from "@celo/attribution-tags";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { TOKENS, tokenByAddress } from "../agent/src/lib/tokens.js";

if (!globalThis.crypto) {
  // @ts-expect-error -- Node's webcrypto matches the DOM Crypto interface x402 expects.
  globalThis.crypto = webcrypto;
}

const FACTORY: Address = getAddress(process.env.ORYN_V2_FACTORY ?? "0x229b68DbAC7d53497eAd2981f95d5dF2cE9fFA50");
const API = (process.env.ORYN_API ?? "https://oryn-agent-production.up.railway.app").replace(/\/$/, "");
const SITE = "https://oryn.click";
const TAG = process.env.ATTRIBUTION_TAG ?? "celo_4781ba9a079a";
const NETWORK = "eip155:42220";

const vaultAbi = parseAbi([
  "struct Leg { address recipient; uint16 bps; address payoutToken; }",
  "struct Link { address token; uint256 amount; uint32 period; bool active; string memo; }",
  "function factory() view returns (address)",
  "function owner() view returns (address)",
  "function getLegs() view returns (Leg[])",
  "function savingsBps() view returns (uint16)",
  "function tokens() view returns (address[])",
  "function pending(address) view returns (uint256)",
  "function linkCount() view returns (uint256)",
  "function getLink(uint256) view returns (Link)",
  "function createLink(address token, uint256 amount, uint32 period, string memo) returns (uint256)",
]);
const factoryAbi = parseAbi(["function vaultOf(address) view returns (address)", "function vaultCount() view returns (uint256)"]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const transport = fallback(["https://forno.celo.org", "https://celo.drpc.org"].map((u) => http(u, { timeout: 20_000, retryCount: 2 })));
const publicClient = createPublicClient({ chain: celo, transport });

const PERIODS: Record<string, number> = { "one-off": 0, weekly: 7 * 86400, monthly: 30 * 86400 };
const periodName = (s: number) => Object.entries(PERIODS).find(([, v]) => v === s)?.[0] ?? `every ${s}s`;
const fmt = (amount: bigint, token: string) => {
  const t = tokenByAddress(token);
  return t ? `${formatUnits(amount, t.decimals)} ${t.symbol}` : `${amount} (unknown token ${token})`;
};
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

function asAddress(value: string, what: string): Address {
  if (!isAddress(value)) throw new Error(`${what} is not a valid address: ${value}`);
  return getAddress(value);
}

/** Refuses anything that isn't a vault created by ORYN's factory, so an agent can't be pointed at a lookalike. */
async function assertOrynVault(vault: Address) {
  const f = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "factory" }).catch(() => null);
  if (!f || getAddress(f) !== FACTORY) throw new Error(`${vault} is not an ORYN v2 vault (factory ${FACTORY}).`);
}

async function readLink(vault: Address, id: bigint) {
  const [link, legs, savingsBps] = await Promise.all([
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "getLink", args: [id] }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "getLegs" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "savingsBps" }),
  ]);
  return { link, legs, savingsBps };
}

function splitPreview(amount: bigint, token: string, legs: readonly { recipient: Address; bps: number }[], savingsBps: number) {
  const rows: { to: string; share: string; amount: string }[] = legs.map((l) => ({ to: l.recipient, share: `${l.bps / 100}%`, amount: fmt((amount * BigInt(l.bps)) / 10000n, token) }));
  if (savingsBps) rows.push({ to: "vault savings", share: `${savingsBps / 100}%`, amount: fmt((amount * BigInt(savingsBps)) / 10000n, token) });
  const used = legs.reduce((s, l) => s + l.bps, 0) + savingsBps;
  if (used < 10000) rows.push({ to: "owner balance", share: `${(10000 - used) / 100}%`, amount: fmt((amount * BigInt(10000 - used)) / 10000n, token) });
  return rows;
}

const server = new McpServer({ name: "oryn", version: "1.0.0" });

server.registerTool(
  "oryn_vault_summary",
  {
    title: "ORYN vault summary",
    description: "Read an ORYN vault on Celo mainnet: owner, split rules, balances waiting to be split, and its pay links. Pass a vault address, or an owner wallet to look up their vault.",
    inputSchema: { address: z.string().describe("ORYN vault address, or the owner's wallet address") },
  },
  async ({ address }) => {
    try {
      let vault = asAddress(address, "address");
      const viaOwner = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "vaultOf", args: [vault] });
      if (!/^0x0{40}$/i.test(viaOwner)) vault = getAddress(viaOwner);
      await assertOrynVault(vault);
      const [owner, legs, savingsBps, tokens, linkCount] = await Promise.all([
        publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "owner" }),
        publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "getLegs" }),
        publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "savingsBps" }),
        publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "tokens" }),
        publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "linkCount" }),
      ]);
      const pending = await Promise.all(tokens.map(async (t) => ({ token: t, amount: await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "pending", args: [t] }) })));
      const links = await Promise.all(Array.from({ length: Number(linkCount) }, async (_, i) => {
        const l = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "getLink", args: [BigInt(i)] });
        return { id: i, amount: fmt(l.amount, l.token), memo: l.memo, type: periodName(l.period), active: l.active, payUrl: `${SITE}/pay?v=${vault}&l=${i}` };
      }));
      return text({
        vault, owner,
        split: legs.map((l): { recipient: string; share: string } => ({ recipient: l.recipient, share: `${l.bps / 100}%` })).concat(savingsBps ? [{ recipient: "savings (kept in vault)", share: `${savingsBps / 100}%` }] : []),
        waitingToSplit: pending.filter((p) => p.amount > 0n).map((p) => fmt(p.amount, p.token)),
        payLinks: links,
        proof: `${SITE}/proof`,
        explorer: `https://celoscan.io/address/${vault}#tokentxns`,
      });
    } catch (err) { return fail(err instanceof Error ? err.message : String(err)); }
  },
);

server.registerTool(
  "oryn_get_pay_link",
  {
    title: "Read an ORYN pay link",
    description: "Read an ORYN pay link from the chain before paying it: amount, currency, memo, and exactly how the payment will be split. Accepts a full oryn.click/pay URL, or a vault plus link id.",
    inputSchema: {
      url: z.string().optional().describe("A pay link like https://oryn.click/pay?v=0x...&l=0"),
      vault: z.string().optional(),
      linkId: z.number().int().nonnegative().optional(),
    },
  },
  async (args) => {
    try {
      const { vault, id } = parseLinkArgs(args);
      await assertOrynVault(vault);
      const { link, legs, savingsBps } = await readLink(vault, id);
      return text({
        vault, linkId: Number(id), amount: fmt(link.amount, link.token), memo: link.memo, type: periodName(link.period), active: link.active,
        willSplit: splitPreview(link.amount, link.token, legs, savingsBps),
        payUrl: `${SITE}/pay?v=${vault}&l=${id}`,
        x402Endpoint: `${API}/pay/${vault}/${id}`,
      });
    } catch (err) { return fail(err instanceof Error ? err.message : String(err)); }
  },
);

server.registerTool(
  "oryn_pay_link",
  {
    title: "Pay an ORYN pay link over x402",
    description: "Pay an ORYN pay link in USA₮ (or the link's currency) over x402 on Celo mainnet, using the wallet in ORYN_PAYER_PRIVATE_KEY. The wallet only signs an authorisation; Celo's facilitator settles it and pays the gas. The payment is capped at exactly the link's amount, and refused if it exceeds maxAmount. Always show the user the amount and split (oryn_get_pay_link) and get their go-ahead first.",
    inputSchema: {
      url: z.string().optional(),
      vault: z.string().optional(),
      linkId: z.number().int().nonnegative().optional(),
      maxAmount: z.string().describe("The most you agree to pay, in the link's currency, e.g. \"1\" for 1 USA₮. The payment is refused if the link asks for more."),
    },
  },
  async (args) => {
    try {
      const key = process.env.ORYN_PAYER_PRIVATE_KEY as `0x${string}` | undefined;
      if (!key) return fail("Set ORYN_PAYER_PRIVATE_KEY to a wallet holding the link's currency to pay links.");
      const payer = privateKeyToAccount(key);
      const { vault, id } = parseLinkArgs(args);
      await assertOrynVault(vault);
      const { link, legs, savingsBps } = await readLink(vault, id);
      if (!link.active) return fail("This pay link is switched off by its owner.");
      const token = tokenByAddress(link.token);
      if (!token) return fail(`This link uses a token ORYN can't settle over x402: ${link.token}`);
      if (link.amount > parseUnits(args.maxAmount, token.decimals)) return fail(`The link asks for ${fmt(link.amount, link.token)}, more than your maxAmount of ${args.maxAmount} ${token.symbol}. Nothing was paid.`);
      const balance = await publicClient.readContract({ address: link.token, abi: erc20Abi, functionName: "balanceOf", args: [payer.address] });
      if (balance < link.amount) return fail(`The payer wallet ${payer.address} holds ${fmt(balance, link.token)} and the link needs ${fmt(link.amount, link.token)}.`);

      const payFetch = wrapFetchWithPaymentFromConfig(fetch, {
        schemes: [{ network: NETWORK, client: new ExactEvmScheme(payer) }],
        // Cap the signature at exactly this link's amount, in this token only.
        spendControls: { maxAmountPerPayment: false, allowedAssets: [{ network: NETWORK, asset: link.token, maxAmountPerPayment: link.amount.toString() }] },
      });
      const res = await payFetch(`${API}/pay/${vault}/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const header = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
      const settle = header ? JSON.parse(Buffer.from(header, "base64").toString("utf8")) : null;
      if (!res.ok || settle?.success === false) return fail(`Payment failed (${res.status}): ${settle?.errorReason ?? (await res.text())}`);
      const tx = settle?.transaction as string | undefined;
      return text({
        paid: fmt(link.amount, link.token), from: payer.address, toVault: vault, memo: link.memo,
        settlementTx: tx ? `https://celoscan.io/tx/${tx}` : "settled (no tx hash returned)",
        willSplit: splitPreview(link.amount, link.token, legs, savingsBps),
        note: "ORYN's agent splits the payment onchain within about 15 seconds. It appears at https://oryn.click/proof.",
      });
    } catch (err) { return fail(err instanceof Error ? err.message : String(err)); }
  },
);

server.registerTool(
  "oryn_create_pay_link",
  {
    title: "Create an ORYN pay link",
    description: "Create a pay link on your ORYN vault (wallet in ORYN_OWNER_PRIVATE_KEY must own a vault; create one at https://oryn.click/vault). Sends one tagged Celo transaction (a few cents of CELO). Returns the shareable link. Confirm the amount and memo with the user first.",
    inputSchema: {
      currency: z.enum(TOKENS.map((t) => t.symbol) as [string, ...string[]]).default("USAT"),
      amount: z.string().describe("Amount in the chosen currency, e.g. \"25\""),
      memo: z.string().max(140).describe("What the payment is for, shown to the payer"),
      type: z.enum(["one-off", "weekly", "monthly"]).default("one-off"),
    },
  },
  async ({ currency, amount, memo, type }) => {
    try {
      const key = process.env.ORYN_OWNER_PRIVATE_KEY as `0x${string}` | undefined;
      if (!key) return fail("Set ORYN_OWNER_PRIVATE_KEY to your vault owner's key to create pay links.");
      const owner = privateKeyToAccount(key);
      const vaultRaw = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "vaultOf", args: [owner.address] });
      if (/^0x0{40}$/i.test(vaultRaw)) return fail(`${owner.address} has no ORYN vault yet. Create one at ${SITE}/vault first.`);
      const vault = getAddress(vaultRaw);
      const token = TOKENS.find((t) => t.symbol === currency)!;
      const units = parseUnits(amount, token.decimals);
      if (units <= 0n) return fail("Amount must be more than zero.");
      const id = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "linkCount" });
      const data = concatHex([encodeFunctionData({ abi: vaultAbi, functionName: "createLink", args: [token.address, units, PERIODS[type], memo] }), toDataSuffix(TAG)]);
      const wallet = createWalletClient({ account: owner, chain: celo, transport });
      const hash = await wallet.sendTransaction({ to: vault, data });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") return fail(`The transaction reverted: https://celoscan.io/tx/${hash}`);
      return text({ created: `${amount} ${token.symbol} · ${memo} · ${type}`, payUrl: `${SITE}/pay?v=${vault}&l=${id}`, tx: `https://celoscan.io/tx/${hash}`, attributionTag: TAG });
    } catch (err) { return fail(err instanceof Error ? err.message : String(err)); }
  },
);

function parseLinkArgs(args: { url?: string; vault?: string; linkId?: number }) {
  if (args.url) {
    const u = new URL(args.url);
    const v = u.searchParams.get("v"), l = u.searchParams.get("l");
    if (!v || l === null) throw new Error("That URL isn't an ORYN pay link (expected ?v=<vault>&l=<id>).");
    return { vault: asAddress(v, "vault"), id: BigInt(l) };
  }
  if (!args.vault || args.linkId === undefined) throw new Error("Pass either url, or vault and linkId.");
  return { vault: asAddress(args.vault, "vault"), id: BigInt(args.linkId) };
}

await server.connect(new StdioServerTransport());
