import type { Express, NextFunction, Request, Response } from "express";
import type { RouteConfig } from "@x402/core/http";
import { declareEip2612GasSponsoringExtension } from "@x402/extensions";
import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { publicClient } from "../agent/src/lib/celoClient.js";
import { vaultV2Abi } from "../agent/src/lib/abiV2.js";
import { tokenByAddress, type TokenInfo } from "../agent/src/lib/tokens.js";

// ORYN pay links over x402.
//
// Every payment link lives onchain in its owner's OrynVaultV2 (createLink). This endpoint turns
// one into a standard x402 resource: the 402 names the link's exact token and amount, and
// payTo is the vault itself, so Celo's facilitator settles the payer's signed authorisation
// straight into the owner's vault. The payer sends no transaction and needs no gas; nothing
// passes through ORYN. Any x402 client works: the pay page on oryn.click, or another agent.

const CELO_NETWORK = "eip155:42220";
const LINK_TTL_MS = 30_000;
const PAY_PATH = /^\/pay\/(0x[0-9a-fA-F]{40})\/(\d{1,9})$/;

export type ResolvedLink = {
  vault: Address;
  linkId: bigint;
  token: TokenInfo;
  amount: bigint;
  period: number;
  memo: string;
  owner: Address;
};

const cache = new Map<string, { link: ResolvedLink; at: number }>();

function factoryV2(): Address {
  const f = process.env.ORYN_V2_FACTORY;
  if (!f || !isAddress(f)) throw new Error("ORYN_V2_FACTORY is not set");
  return getAddress(f);
}

class LinkError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Reads and validates a link from chain. Only vaults deployed by ORYN's v2 factory qualify. */
export async function resolveLink(vaultParam: string, idParam: string): Promise<ResolvedLink> {
  if (!isAddress(vaultParam)) throw new LinkError(404, "Unknown vault");
  const vault = getAddress(vaultParam);
  const linkId = BigInt(idParam);
  const key = `${vault}:${linkId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < LINK_TTL_MS) return hit.link;

  let factory: Address;
  try {
    factory = await publicClient.readContract({ address: vault, abi: vaultV2Abi, functionName: "factory" });
  } catch {
    throw new LinkError(404, "Not an ORYN vault");
  }
  if (getAddress(factory) !== factoryV2()) throw new LinkError(404, "Not an ORYN vault");

  const count = await publicClient.readContract({ address: vault, abi: vaultV2Abi, functionName: "linkCount" });
  if (linkId >= count) throw new LinkError(404, "Unknown payment link");

  const [raw, owner] = await Promise.all([
    publicClient.readContract({ address: vault, abi: vaultV2Abi, functionName: "getLink", args: [linkId] }),
    publicClient.readContract({ address: vault, abi: vaultV2Abi, functionName: "owner" }),
  ]);
  if (!raw.active) throw new LinkError(410, "This payment link has been turned off by its owner");
  const token = tokenByAddress(raw.token);
  if (!token) throw new LinkError(422, "This link's currency isn't supported for x402 payment");
  if (raw.amount === 0n) throw new LinkError(422, "This link has no amount");

  const link: ResolvedLink = { vault, linkId, token, amount: raw.amount, period: raw.period, memo: raw.memo, owner: getAddress(owner) };
  cache.set(key, { link, at: Date.now() });
  return link;
}

function linkFromPath(path: string): ResolvedLink {
  const m = PAY_PATH.exec(path);
  const hit = m && cache.get(`${getAddress(m[1])}:${BigInt(m[2])}`);
  // Always populated by validatePayLink, which runs before the payment middleware.
  if (!hit) throw new Error(`pay link not resolved for ${path}`);
  return hit.link;
}

export function linkSummary(link: ResolvedLink) {
  return {
    vault: link.vault,
    linkId: link.linkId.toString(),
    owner: link.owner,
    token: link.token.address,
    symbol: link.token.symbol,
    currency: link.token.currency,
    decimals: link.token.decimals,
    amount: link.amount.toString(),
    amountFormatted: formatUnits(link.amount, link.token.decimals),
    recurringEverySeconds: link.period,
    memo: link.memo,
  };
}

/** x402 route for every pay link. Price and payee come from the link resolved for this request. */
export const payRoutes: Record<string, RouteConfig> = {
  "POST /pay/:vault/:linkId": {
    description: "Pay an ORYN payment link. Settles directly into the owner's vault on Celo.",
    mimeType: "application/json",
    accepts: {
      scheme: "exact",
      network: CELO_NETWORK,
      payTo: (ctx) => linkFromPath(ctx.path).vault,
      price: (ctx) => {
        const { token, amount } = linkFromPath(ctx.path);
        return {
          asset: token.address,
          amount: amount.toString(),
          extra:
            token.transfer === "permit2"
              ? { name: token.eip712Name, version: token.eip712Version, assetTransferMethod: "permit2" }
              : { name: token.eip712Name, version: token.eip712Version },
        };
      },
      maxTimeoutSeconds: 300,
    },
    // Lets Permit2 tokens (wARS, wBRL, wCOP) pay with zero gas and no approval transaction:
    // the client signs an EIP-2612 permit and Celo's facilitator lands it inside settlement.
    extensions: { ...declareEip2612GasSponsoringExtension() },
  },
};

/** Runs before the payment middleware: 404s bad links for free, and warms the link cache. */
export async function validatePayLink(req: Request, res: Response, next: NextFunction) {
  const m = PAY_PATH.exec(req.path);
  if (!m) return next();
  try {
    await resolveLink(m[1], m[2]);
    next();
  } catch (err) {
    const status = err instanceof LinkError ? err.status : 502;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

export function mountPayHandlers(app: Express) {
  // Free: what the pay page and the Telegram bot show before anyone pays.
  app.get("/pay/:vault/:linkId", async (req, res) => {
    try {
      res.json(linkSummary(await resolveLink(req.params.vault, req.params.linkId)));
    } catch (err) {
      const status = err instanceof LinkError ? err.status : 502;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Paid: only reached once the payment middleware has verified the authorisation. Settlement
  // happens as this response completes; the tx hash rides back in the PAYMENT-RESPONSE header.
  app.post("/pay/:vault/:linkId", (req, res) => {
    const link = linkFromPath(req.path);
    res.json({ paid: true, ...linkSummary(link), paidAt: new Date().toISOString() });
  });
}

/** Lets other agents and browsers on other origins call pay links and read the x402 headers. */
export function x402Cors(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, PAYMENT-SIGNATURE, X-PAYMENT, Access-Control-Expose-Headers");
  res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE");
  if (req.method === "OPTIONS") return void res.sendStatus(204);
  next();
}
