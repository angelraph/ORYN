# ORYN — the autonomous treasury agent

Built for the [Celo Agentic Payments & DeFAI Hackathon](https://celobuilders.xyz).

**Every time ORYN receives a payment, it splits it — automatically, onchain, non-custodially.**
No dashboards, no manual transfers, no spreadsheets. A freelancer, creator, or small
merchant gets paid in cUSD, and ORYN executes the payout rules they already approved:
save a %, pay a collaborator, keep the rest — as real Celo mainnet transactions.

## Why this is not a demo

Every action ORYN takes is a real transaction against a live Celo mainnet contract,
tagged with ORYN's registered attribution code so it's independently verifiable on the
hackathon leaderboard:

- **Attribution tag:** `celo_2a23542d598e`
- **Vault factory (mainnet):** [`0xf3174fd03446bdef0c0a9a0ec0c263bc6bec328b`](https://celoscan.io/address/0xf3174fd03446bdef0c0a9a0ec0c263bc6bec328b)
- **Agent wallet:** [`0xeae6959bE76b5f2ad2142A6fe5E4Cf4F9Ca45d26`](https://celoscan.io/address/0xeae6959bE76b5f2ad2142A6fe5E4Cf4F9Ca45d26)

## How it works

1. **A user creates a vault** (`OrynVaultFactory.createVault`) and sets a split — e.g.
   "20% to savings, 30% to my designer, remainder stays in the vault."
2. **Anyone pays into the vault** (a client settling an invoice, a customer, etc.).
3. **ORYN's agent detects the deposit** and calls `distribute()` — the *only* action the
   agent wallet is authorized to take. It cannot withdraw funds or redirect them
   anywhere the owner didn't already approve. That boundary is enforced onchain, not by
   trust: see `OrynVault.onlyAgentOrOwner`.
4. **The split executes as a real transaction**, tagged with ORYN's attribution code
   (`@celo/attribution-tags`), so it counts on the **Most Revenue Generated** leaderboard.
5. **ORYN pays itself** via the [x402 protocol](https://x402.celo.org) for a small
   bookkeeping/categorization step on every distribution — a genuine pay-per-request
   settlement in USDC, counting toward **Most x402 Payments**.

```
payer ──deposit(cUSD)──▶ OrynVault ──agent calls distribute()──▶ recipients + savings
                                            │
                                            └──x402 pay (USDC)──▶ categorization service
```

## Non-custodial by design

The agent wallet can call `distribute()` — nothing else. It can never call `withdraw()`,
never change `rules`, never touch funds outside the split the *owner* configured. This
is a hard onchain guarantee (`OrynVault.sol`), not a policy promise.

## Project layout

```
contracts/
  OrynVault.sol          — per-user treasury: rules, deposit, distribute, withdraw
  OrynVaultFactory.sol   — deploys one vault per owner
  mocks/MockERC20.sol    — test-only stand-in for cUSD
agent/src/
  watcher.ts             — polls Celo mainnet for new vaults + deposits
  executor.ts            — triggers distribute(), tagged, then pays x402 for categorization
  lib/attribution.ts     — the single funnel every outgoing tx passes through
  lib/celoClient.ts       — viem clients for the agent wallet
x402-service/
  server.ts               — the paid categorization endpoint (x402 v2, Celo facilitator)
  client.ts                — the agent's x402 payment client
scripts/deploy.ts          — deploys OrynVaultFactory
test/OrynVault.test.ts     — vault split logic + access-control guarantees
```

## Running it

```bash
npm install
cp .env.example .env   # fill in AGENT_PRIVATE_KEY etc.
npm test                # contract tests
npm run deploy:mainnet  # deploy OrynVaultFactory (already done — see address above)
npm run x402:serve      # start the paid categorization service
npm run agent           # start the watcher/executor loop
```

## Tracks

- **Most Revenue Generated** — every deposit + distribution is a real, tagged cUSD
  transaction on Celo mainnet.
- **Most x402 Payments** — every distribution triggers a real USDC x402 settlement to
  ORYN's own categorization service via the Celo facilitator (`api.x402.celo.org`).
