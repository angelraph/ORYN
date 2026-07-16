import "dotenv/config";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { agentAccount } from "../agent/src/lib/celoClient.js";

const X402_SERVICE_URL = process.env.X402_SERVICE_URL ?? `http://localhost:${process.env.X402_PORT ?? 4021}`;
const CELO_NETWORK = "eip155:42220";

const fetchWithPay = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: CELO_NETWORK, client: new ExactEvmScheme(agentAccount) }],
});

/**
 * Pays ORYN's own categorization service in USDC via x402, then returns the
 * category. Called by the agent after every distribute() — a real, pay-per-request
 * settlement that counts toward the Most x402 Payments track.
 */
export async function categorizeDistribution(params: {
  vault: `0x${string}`;
  recipient: `0x${string}`;
  amount: string;
}) {
  const response = await fetchWithPay(`${X402_SERVICE_URL}/categorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    // The actual failure reason lives in the PAYMENT-RESPONSE (settlement attempted
    // and rejected) or PAYMENT-REQUIRED (never got that far) header, base64-encoded
    // JSON with an errorReason field — not in the body, which is usually just `{}`.
    const paymentHeader =
      response.headers.get("payment-response") ?? response.headers.get("payment-required");
    let detail = await response.text();
    if (paymentHeader) {
      try {
        detail = Buffer.from(paymentHeader, "base64").toString("utf-8");
      } catch {
        // fall through to the raw body text already captured above
      }
    }
    throw new Error(`categorize request failed: ${response.status} ${detail}`);
  }

  return response.json();
}
