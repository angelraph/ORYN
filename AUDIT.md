# Internal review

This is our own review of ORYN v2, written to be read by judges and users. It is **not** an external audit.

## Scope

- `contracts/OrynVaultV2.sol`, `contracts/OrynVaultFactoryV2.sol`
- `agent/src/watcherV2.ts`, `agent/src/lib/attribution.ts`
- `x402-service/pay.ts`, `x402-service/server.ts`
- `web/pay.html`, `web/vault.html`, `web/assets/oryn-v2.js`
- `mcp/server.ts`

## Assets and actors

| Actor | Can |
|---|---|
| Owner | Everything on their own vault: rules, tokens, links, agent, withdraw |
| Agent | Run splits, release queued FX legs to their recipients, convert within the owner's daily cap through the factory's one swap target |
| Payer | Send tokens to a vault, directly or through an x402 authorisation |
| Facilitator (Celo) | Submit the payer's signed authorisation; it can't change the amount, token or recipient |
| Anyone | Read everything |

## What is enforced onchain

- **The agent can't withdraw or change rules.** Owner-only functions use `onlyOwner`; the agent's functions use `onlyAgentOrOwner`. Covered by tests "never lets the agent withdraw" and "keeps the agent and strangers away from owner powers".
- **Splits can't exceed 100%,** must name real recipients, and may only use accepted tokens (test "validates policies").
- **A vault always has a split.** `createVault` refuses an empty policy, so payments can't arrive with no rules.
- **Conversions are bounded.** Only the factory's swap target, only the queued sell token, only up to the owner's daily cap, and only if enough of the buy token comes back. A short fill returns the unspent amount to the same destination (tests "converts queued savings…", "returns unspent sell amount…", "never lets a swap pull a token…", "enforces the owner's daily conversion cap").
- **Earmarked funds are protected.** The owner can't withdraw amounts already queued for someone else's conversion.
- **Clones can't be hijacked.** The implementation is locked, and each clone initialises exactly once.

## What is enforced off-chain

- **x402 amount and recipient.** The x402 service builds the payment requirement from the link stored onchain: exact token, exact amount, `payTo` = the vault. The browser and the MCP server additionally cap the signature at exactly the link's amount.
- **Lookalike links.** The pay page and MCP server check that the vault's `factory()` is ORYN's factory before showing or paying a link.
- **Attribution.** All agent and owner transactions go through one tagging funnel; `scripts/verifyTags.ts` checks any transaction.

## Known limits

| Area | Limit | Impact | Plan |
|---|---|---|---|
| Audit | No external audit yet | Unknown bugs may exist | Audit before promoting large amounts |
| FX | The agent's Textile FX quote path isn't built | FX legs are released unconverted after 10 minutes | Wire in Textile RFQ quotes |
| Liveness | One agent instance on Railway | If it stops, splits pause; funds stay safe in the vault and the owner can withdraw | Add a second keeper; owners can replace the agent |
| Pay links | "One-off" is a label; a link stays payable until the owner switches it off | A link can be paid more than once | Optional auto-close after the first payment |
| Proof page | Independence signals come from Blockscout and a capped history walk | Very active wallets may show a later "active since" date than the true one | Fine for review; judges can confirm on Celoscan |
| Sanctions screening | Relies on Chainalysis' onchain oracle; if it can't be read, the x402 service logs it and lets the payment through rather than blocking every payer | A flagged payer could slip through during an oracle outage | Acceptable trade-off for liveness; revisit with a second list |
| Private splits | Hiding the split is a pay-page display choice (`&p=1`); the split itself is public onchain | Someone reading the contract can still work it out | Stated plainly to users |
| MCP keys | Write tools read private keys from the environment | Anyone with access to that machine can use them | Use a dedicated small-balance payer wallet |

## Disclosure

Found something? Open an issue at [github.com/angelraph/ORYN](https://github.com/angelraph/ORYN/issues).
