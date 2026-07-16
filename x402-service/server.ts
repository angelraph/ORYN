import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const PORT = process.env.X402_PORT ?? 4021;
const PAY_TO = process.env.X402_SELLER_PAYOUT_ADDRESS as `0x${string}` | undefined;
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? "https://api.x402.celo.org";
const USDC_ADDRESS = process.env.USDC_ADDRESS ?? "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
const CELO_NETWORK = "eip155:42220"; // CAIP-2 id for Celo mainnet (chain 42220)
const X402_API_KEY = process.env.X402_API_KEY;

if (!PAY_TO) {
  throw new Error("X402_SELLER_PAYOUT_ADDRESS is not set in .env");
}
if (!X402_API_KEY) {
  throw new Error(
    "X402_API_KEY is not set in .env — get one at https://x402.celo.org (connect wallet -> Create API key)",
  );
}

const app = express();
app.use(express.json());

// The facilitator meters verify/settle/supported by X-API-Key. Without this,
// /settle rejects with 401 "Missing X-API-Key" — verified against Celo's own
// reference implementation (celo-org/x402-celo-example-deprecated).
const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  createAuthHeaders: async () => {
    const headers = { "X-API-Key": X402_API_KEY! };
    return { verify: headers, settle: headers, supported: headers };
  },
});
const resourceServer = new x402ResourceServer(facilitatorClient).register(CELO_NETWORK, new ExactEvmScheme());

// A real, small paid service: ORYN's own bookkeeping/categorization step. Every
// distribution the agent executes gets categorized here — a genuine pay-per-call
// dependency, settled in USDC via the Celo x402 facilitator (cUSD isn't supported
// by the facilitator, so this leg uses USDC while the treasury logic stays cUSD).
// Celo isn't one of x402's "default asset" networks, so the asset must be given
// explicitly (asset address + base-unit amount) rather than a "$0.001" dollar string.
app.use(
  paymentMiddleware(
    {
      "POST /categorize": {
        accepts: {
          scheme: "exact",
          // $0.001 USDC (6 decimals). extra.name/version are the EIP-712 domain for
          // USDC's transferWithAuthorization signature — required because Celo isn't
          // one of x402's "known" networks with a built-in domain lookup. Verified
          // on-chain via the token's own name()/version() calls, not guessed.
          price: { asset: USDC_ADDRESS, amount: "1000", extra: { name: "USDC", version: "2" } },
          network: CELO_NETWORK,
          payTo: PAY_TO,
        },
        description: "Categorize an ORYN treasury distribution for bookkeeping",
      },
    },
    resourceServer,
  ),
);

app.post("/categorize", (req, res) => {
  const { vault, amount, recipient } = req.body ?? {};
  // Minimal real logic: bucket the distribution by size. Deliberately simple —
  // the point of this endpoint is to be a real, paid, agent-to-agent dependency,
  // not a sophisticated classifier.
  const numericAmount = Number(amount ?? 0);
  const category = numericAmount === 0 ? "unknown" : numericAmount < 10 ? "micro-payout" : "payout";

  res.json({ vault, recipient, amount, category, categorizedAt: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[x402-service] listening on :${PORT}, paid via facilitator ${FACILITATOR_URL}`);
});
