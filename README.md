# ORYN: the autonomous treasury agent

Built for **Celo Agents on Open Rails**, primary track **Stable Agents: Open Corridors, USA₮ with x402**.

**Website:** [oryn.click](https://oryn.click) · [Vault & pay links](https://oryn.click/vault) · [Classic app](https://oryn.click/app) · [Docs](https://oryn.click/docs)

**Send a pay link. Get paid in USA₮, USDC, wARS, wBRL or wCOP. ORYN splits the payment onchain the moment it lands, without ever holding your money.**

A freelancer, creator or small merchant creates a vault once and decides how every payment is divided: say 30% to a designer, 20% saved, the rest kept. They share a pay link. The client pays it over **x402**: one signature, **no gas, no CELO needed**, settled by Celo's facilitator straight into the owner's own vault. ORYN's agent sees the balance arrive and executes the split as a tagged mainnet transaction. Another agent can pay the same link: it's a standard x402 resource.

## Onchain, verifiable

| | |
|---|---|
| Attribution tag | `celo_4781ba9a079a` (Agents on Open Rails; earlier activity used `celo_2a23542d598e`) |
| ERC-8004 agent identity | [agentId 9688](https://8004scan.io/agents/celo/9688) |
| Agent wallet | [`0xeae6959bE76b5f2ad2142A6fe5E4Cf4F9Ca45d26`](https://celoscan.io/address/0xeae6959bE76b5f2ad2142A6fe5E4Cf4F9Ca45d26) |
| Vault factory v2 (USA₮, USDC, USD₮, wARS, wBRL, wCOP) | [`0x229b68DbAC7d53497eAd2981f95d5dF2cE9fFA50`](https://celoscan.io/address/0x229b68DbAC7d53497eAd2981f95d5dF2cE9fFA50) ([tagged deploy tx](https://celoscan.io/tx/0xdfae6f4ecd0da83824b44af7bbd361feefe5261b63227007c00bfd69bcd2581f)) |
| Vault v2 implementation (locked, clones delegate to it) | [`0x2348B97e2527C030aE983Ca0e763dD26E2BEb4D3`](https://celoscan.io/address/0x2348B97e2527C030aE983Ca0e763dD26E2BEb4D3) |
| Vault factory v1 (cUSD) | [`0xcb45e24d147262302b6e7dac579e8ae4d879ef19`](https://celoscan.io/address/0xcb45e24d147262302b6e7dac579e8ae4d879ef19) |
| Chain | Celo mainnet, chain id `42220`, RPC `https://forno.celo.org` (Celo Sepolia is `11142220`) |

Every transaction ORYN or its users send goes through one funnel that appends the ERC-8021 tag (`agent/src/lib/attribution.ts`, and `withTag()` / `send()` in the web app). `npx tsx scripts/verifyTags.ts <txHash>` decodes any transaction and confirms the tag.

### Live on mainnet

A real payment, end to end: an independent wallet (active on Celo since 2021) paid a 1 USA₮ ORYN pay link with one signature. Celo's x402 facilitator [settled it into the vault](https://celoscan.io/tx/0xb08a80a92c880a6f3f836b873366ec99d35b448608d9fb800ad2f858fa75ce5c), and the agent [split it](https://celoscan.io/tx/0x10c0c986d104ff581c061017d8d20bbbc375f5249615c9ec9fab33c4350cbede) 17 blocks later in a tagged transaction: 90% to the collaborator, 10% kept as savings. All payments into a vault and splits out of it: `npx tsx scripts/vaultPayments.ts <vault>`.

## How it works

```
client / agent ──x402 sign (no gas)──▶ Celo facilitator ──transfer──▶ OrynVaultV2 (owner's)
                                                                        │
                       ORYN agent: pending(token) > 0 ──distribute(token), tagged──┤
                                                                        ▼
                                          collaborators · savings · owner's balance
```

1. **Create a vault** at [/vault](https://oryn.click/vault): one transaction, `OrynVaultFactoryV2.createVault(legs, savingsBps, …)`. A split is mandatory from block one, so a vault can never silently swallow payments with no rules (half of all v1 vaults ended up that way).
2. **Create a pay link**: currency, amount, memo, one-off / weekly / monthly. It's stored onchain in the vault (`createLink`), so there's no database to trust. Share the URL, the QR code, or the share sheet.
3. **The client pays** at `oryn.click/pay?v=<vault>&l=<id>`. The page reads the link from the chain, shows exactly how the payment will be split, then pays through `x402-service` (`POST /pay/:vault/:linkId`). The 402 names the link's exact token and amount and `payTo` is the vault, so the facilitator settles the signed authorisation (EIP-3009 for USA₮/USDC/USD₮, Permit2 + EIP-2612 gas sponsoring for wARS/wBRL/wCOP) directly into the vault. A plain wallet transfer works too, as a fallback.
4. **The agent splits it.** v2 vaults are balance-based, so the agent reads `pending(token)` for every token of every vault in one multicall every 15 s and calls `distribute(token)` once a payment clears a dust floor (about 5¢), so a dust transfer can't make it spend more gas than the split is worth (`agent/src/watcherV2.ts`).
5. **FX legs (contract-level).** A leg can ask to be paid in another currency. `distribute` queues it onchain, and `convert` can settle it through Textile FX's reactor, guarded by onchain spend/receive checks and an owner-set daily cap. The agent's Textile quote path isn't wired in yet, and the web app creates same-currency splits only. So today a queued leg is released to its recipient in the currency that arrived after 10 minutes, and nobody is left unpaid.

## Non-custodial by design

The agent can split, convert through the one allow-listed swap contract within the owner's daily cap, or release a queued leg to its own recipient. It can **never** withdraw, change the split, add tokens, or send funds anywhere the owner didn't choose. That is enforced in `OrynVaultV2.sol` (`onlyAgentOrOwner`, `onlyOwner`), not promised. Each owner can also swap out the agent for their own.

**Gas:** when a client pays over x402, Celo's facilitator relays the settlement and pays its gas; the payer only signs. ORYN's own `distribute()` and release calls are paid by ORYN's agent wallet. Owners pay gas for their own vault setup, link and withdraw transactions.

## Run it

Requirements: Node 20+, a Celo mainnet wallet with a little CELO for the agent.

```bash
npm install
cp .env.example .env    # fill in AGENT_PRIVATE_KEY, X402_API_KEY, X402_SELLER_PAYOUT_ADDRESS
npm test                # 19 contract tests: splits, FX guards, pay links, clones, access control
npx hardhat compile
npx tsx scripts/deployV2.ts --dry-run   # estimate gas; drop --dry-run to deploy (tagged)
# put the printed factory address in ORYN_V2_FACTORY (.env) and in web/assets/oryn-v2.js
npm run agent:forever   # agent (v1 + v2 watchers) and x402-service under one supervisor
```

Frontend: `web/` is static HTML (Vercel, clean URLs). Locally: `python -m http.server 5173 --directory web`, then open `/vault.html`. Set `ORYN_API` in `web/assets/oryn-v2.js` to the x402-service's public URL to enable gasless payments on the pay page.

Without secrets, everything still starts in read-only form: the pages read the chain directly, and `npm test` needs no keys.

## Project layout

```
contracts/
  OrynVaultV2.sol         multi-currency, balance-based vault: split, FX legs, pay links, withdraw
  OrynVaultFactoryV2.sol  one EIP-1167 clone per owner (about 435k gas to create)
  OrynVault*.sol          v1 cUSD vaults (still live)
agent/src/
  watcherV2.ts            v2 loop: multicall pending balances, distribute, release stuck FX legs
  watcher.ts / executor.ts  v1 loop
  lib/attribution.ts      the single tagged-transaction funnel
  lib/tokens.ts           the accepted currencies, their EIP-712 domains, and dust floors
x402-service/
  pay.ts                  pay links as x402 resources (GET details, POST to pay)
  server.ts               x402 resource server on the Celo facilitator
web/
  vault.html              create a vault, pay links (copy, QR, share), split, activity, withdraw
  pay.html                public pay page: gasless x402 or plain transfer
  assets/oryn-v2.js       shared chain reads, wallet, tagged send, x402 signer
```

## Design

The interface follows the [Celo brand kit](https://celo.org/brand-kit): Gypsum surfaces with Onyx type, Prosperity Yellow calls to action, Forest bands, and accent colors used only as tags. The display face is Fraunces Light, standing in for GT Alpina Thin, which needs a licence. ORYN keeps its own logo.
