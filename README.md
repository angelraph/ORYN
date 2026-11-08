# ORYN

**Pay links that split themselves.**

ORYN is a payment agent on Celo mainnet for freelancers, creators and small teams who get paid in dollars. You create a vault once and decide how every payment is divided. You share a pay link. Your client pays it in USA₮ with one signature and no gas, Celo's x402 facilitator settles it into your own vault, and ORYN's agent splits it onchain within seconds: collaborators paid, savings set aside, the rest yours. ORYN never holds your money, and its agent can't withdraw it.

Any AI agent can use ORYN too: through the [ORYN MCP server](AGENT.md#the-oryn-mcp-server), Claude, Cursor or any MCP client can read a vault, create pay links and pay ORYN links over x402 by itself.

[**Live app: oryn.click**](https://oryn.click) · [**Create a vault**](https://oryn.click/vault) · [**Live proof: every payment**](https://oryn.click/proof) · [Factory on Celoscan](https://celoscan.io/address/0x229b68DbAC7d53497eAd2981f95d5dF2cE9fFA50) · [Agent identity (ERC-8004)](https://8004scan.io/agents/celo/9688) · [Submission](SUBMISSION.md) · [Agent and MCP](AGENT.md) · [Internal review](AUDIT.md)

Built by angelraph for **Celo Agents on Open Rails** (loops.house), track **Stable Agents: Open Corridors, USA₮ with x402**.

## At a glance

| | |
|---|---|
| **Network** | Celo mainnet (chain 42220) |
| **What it does** | Pay links that settle USA₮ over x402 (gasless for the payer) into the owner's own vault, then split onchain by an autonomous agent |
| **Our contracts on mainnet** | `OrynVaultFactoryV2` (one EIP-1167 vault clone per owner), `OrynVaultV2` implementation (locked), plus the v1 cUSD factory |
| **Currencies** | USA₮, USDC, USD₮ (EIP-3009) and wARS, wBRL, wCOP (Permit2 with EIP-2612 gas sponsoring) |
| **Autonomous agent** | Live on Railway. Reads every vault's pending balance every 15 s in one multicall and calls `distribute()` as a tagged transaction |
| **Agent-native** | x402 pay links any agent can pay, plus an MCP server with 4 tools (read vault, read link, pay link, create link) |
| **Payer safety** | Every payer is screened against Chainalysis' onchain sanctions oracle on Celo, in the pay page, the x402 service and the MCP server |
| **For LatAm** | Pay page and receipts in English, Spanish and Portuguese; pay links from one sentence in any of the three ("cobrar 4500 pesos pizza"); WhatsApp sharing |
| **Receipts** | A printable receipt for every payment at `/receipt`, read from the chain: payer, settlement, method, and the agent's split |
| **Private splits** | A link variant that hides who gets what from the payer, for paying subcontractors without putting their rate on the invoice |
| **Proof** | [oryn.click/proof](https://oryn.click/proof): every payment and split, read live from the chain, with independence signals per payer |
| **Attribution** | ERC-8021 tag `celo_4781ba9a079a` on every transaction ORYN, its agent and its users send |
| **Tests** | 19 contract tests (splits, FX guards, pay links, clones, access control), all passing |

## Contents

- [The idea in one minute](#the-idea-in-one-minute)
- [Live on Celo mainnet](#live-on-celo-mainnet)
- [Why ORYN](#why-oryn)
- [Product tour](#product-tour)
- [How it works](#how-it-works)
- [The ORYN agent](#the-oryn-agent)
- [For AI agents: x402 and MCP](#for-ai-agents-x402-and-mcp)
- [Architecture](#architecture)
- [Design and user experience](#design-and-user-experience)
- [Verification and security](#verification-and-security)
- [Build log](#build-log)
- [Quickstart](#quickstart)
- [Repository layout](#repository-layout)
- [Documentation](#documentation)
- [Risks](#risks)

## The idea in one minute

Getting paid is one moment; what comes after is a chore. A designer finishes a logo, the client pays, and then the designer pays the illustrator their share, moves some into savings, and keeps the rest, by hand, every time. If the client is new to crypto, asking them to buy CELO just to pay gas is usually where the deal stalls.

ORYN turns that into a link:

1. **Set the rules once.** A vault with legs like "30% to my illustrator, 10% saved, the rest mine."
2. **Share a pay link.** A URL or QR code for an amount, a currency and a memo, stored onchain in the vault.
3. **The client signs once.** USA₮ over x402: no gas, no CELO, no new wallet setup.
4. **The agent splits it.** Seconds after the money lands, ORYN's agent runs the split as a tagged mainnet transaction.

## Live on Celo mainnet

| | |
|---|---|
| Vault factory v2 | [`0x229b68DbAC7d53497eAd2981f95d5dF2cE9fFA50`](https://celoscan.io/address/0x229b68DbAC7d53497eAd2981f95d5dF2cE9fFA50) ([tagged deploy tx](https://celoscan.io/tx/0xdfae6f4ecd0da83824b44af7bbd361feefe5261b63227007c00bfd69bcd2581f)) |
| Vault v2 implementation (locked) | [`0x2348B97e2527C030aE983Ca0e763dD26E2BEb4D3`](https://celoscan.io/address/0x2348B97e2527C030aE983Ca0e763dD26E2BEb4D3) |
| Vault factory v1 (cUSD, still live) | [`0xcb45e24d147262302b6e7dac579e8ae4d879ef19`](https://celoscan.io/address/0xcb45e24d147262302b6e7dac579e8ae4d879ef19) |
| Agent wallet | [`0xeae6959bE76b5f2ad2142A6fe5E4Cf4F9Ca45d26`](https://celoscan.io/address/0xeae6959bE76b5f2ad2142A6fe5E4Cf4F9Ca45d26) |
| ERC-8004 identity | [agentId 9688](https://8004scan.io/agents/celo/9688) |
| x402 pay service | `https://oryn-agent-production.up.railway.app` (`/health`, `GET`/`POST /pay/:vault/:linkId`) |
| Attribution tag | `celo_4781ba9a079a` (earlier v1 activity used `celo_2a23542d598e`) |

**A real payment, end to end.** An independent wallet, active on Celo since 2021 and funded on its own through a bridge and a Uniswap swap, paid a 1 USA₮ ORYN link with one signature. Celo's facilitator [settled it into the vault](https://celoscan.io/tx/0xb08a80a92c880a6f3f836b873366ec99d35b448608d9fb800ad2f858fa75ce5c), and the agent [split it](https://celoscan.io/tx/0x10c0c986d104ff581c061017d8d20bbbc375f5249615c9ec9fab33c4350cbede) seconds later in a tagged transaction: 90% to the collaborator, 10% kept as savings.

Every payment since is listed at **[oryn.click/proof](https://oryn.click/proof)**. The page reads the factory, every vault and every transfer from the chain on each visit, and for each payer shows when the wallet first used Celo and who first funded it. Our own test payments are shown and labelled "team test", never hidden.

## Why ORYN

- **Why USA₮.** The people ORYN serves invoice clients abroad and want dollars. USA₮ settles over x402 with an EIP-3009 authorisation, so the payer only signs and never needs gas or CELO.
- **Why a vault per owner.** Splits are enforced by a contract the owner controls, not by a server we run. No database holds the rules or the links.
- **Why an agent.** Splitting is boring, frequent and time-sensitive. An agent that watches every vault and acts within seconds removes the chore without being trusted with the money.
- **Why x402.** A pay link is a standard x402 resource. A person in a browser and an AI agent with a wallet pay it the same way.

## Product tour

| Page | What it does |
|---|---|
| [`/vault`](https://oryn.click/vault) | Create a vault with a live split builder (legs, savings, validation), then manage it: overview, pay links (describe one in a sentence, copy, QR, WhatsApp, share, keep the split private, switch off), split rules, activity, withdraw |
| [`/pay`](https://oryn.click/pay?v=0x1b250e0933E441616Dd81977eF31eC7e2Fff51Bb&l=1) | The public pay page, in English, Spanish or Portuguese. Reads the link from the chain, checks it belongs to an ORYN vault, shows the payer how their money will be split (unless the owner keeps it private), screens the payer against the sanctions list, and pays gasless over x402 (or by plain transfer as a fallback) |
| [`/receipt`](https://oryn.click/receipt?tx=0xb08a80a92c880a6f3f836b873366ec99d35b448608d9fb800ad2f858fa75ce5c&v=0x1b250e0933E441616Dd81977eF31eC7e2Fff51Bb&l=1) | A printable receipt for any payment, read from the chain, in three languages |
| [`/proof`](https://oryn.click/proof) | Every payment into every vault, how it settled, the agent's split, and per-payer independence signals |
| [`/`](https://oryn.click) | Landing page with live network numbers read from the chain |
| [`/app`](https://oryn.click/app) | The classic v1 cUSD app, still live for earlier vaults |

MiniPay users are connected automatically. The interface follows the Celo brand kit and works on phones.

## How it works

```
client / agent ──x402 sign (no gas)──▶ Celo facilitator ──transfer──▶ OrynVaultV2 (owner's)
                                                                        │
                       ORYN agent: pending(token) > 0 ──distribute(token), tagged──┤
                                                                        ▼
                                          collaborators · savings · owner's balance
```

### 1. The vault

`OrynVaultFactoryV2.createVault(legs, savingsBps, …)` deploys a minimal clone (about 435k gas) owned by the caller. A split is mandatory from block one, so a vault can never silently swallow payments with no rules. Vaults are balance-based: anything that arrives, by x402 or plain transfer, is `pending(token)` until split.

### 2. Pay links

`createLink(token, amount, period, memo)` stores the link in the vault itself, so there's nothing off-chain to trust. The link URL is `oryn.click/pay?v=<vault>&l=<id>`.

### 3. Payment over x402

The pay page calls `POST /pay/:vault/:linkId` on the x402 service. The 402 response names the link's exact token and amount, with `payTo` set to the vault, so Celo's facilitator settles the payer's signed authorisation straight into the vault. The client caps the signature at exactly the link's amount, in that token only.

### 4. The split

The agent multicalls `pending(token)` for every token of every vault every 15 seconds and calls `distribute(token)` once a balance clears a dust floor of about 5 US cents, so a dust transfer can't make it spend more gas than the split is worth.

### 5. FX legs (contract level)

A leg can ask to be paid in another currency. `distribute` queues it, and `convert` can settle it through Textile FX's reactor, guarded by onchain spend and receive checks and an owner-set daily cap. The agent's Textile quote path isn't wired in yet, so a queued leg is released to its recipient in the original currency after 10 minutes, and nobody is left unpaid.

## The ORYN agent

The agent ([`agent/src/watcherV2.ts`](agent/src/watcherV2.ts)) runs on Railway next to the x402 service, under one supervisor. It discovers vaults from the factory, refreshes each vault's accepted tokens every 5 minutes, and sends every action through a single funnel that appends the ERC-8021 attribution tag ([`agent/src/lib/attribution.ts`](agent/src/lib/attribution.ts)).

**Trust model.** The agent can split, release a queued leg to its own recipient, or convert through the one allow-listed swap contract within the owner's daily cap. It can never withdraw, change a split, add tokens, or send funds anywhere the owner didn't choose. That is enforced in `OrynVaultV2.sol` (`onlyAgentOrOwner`, `onlyOwner`), and each owner can replace the agent with their own.

**Gas.** x402 settlements are relayed by Celo's facilitator, so that gas isn't ours. ORYN's agent wallet pays its own gas for every `distribute()` and release. Owners pay for their own vault setup, links and withdrawals. All of these carry the tag.

Details: [AGENT.md](AGENT.md).

## For AI agents: x402 and MCP

ORYN works in both directions for agents:

- **Agents can pay ORYN links.** Every link is an x402 resource at `POST https://oryn-agent-production.up.railway.app/pay/<vault>/<linkId>`. A `GET` on the same path returns the link's details for free.
- **Agents can use ORYN as a tool.** The [ORYN MCP server](AGENT.md#the-oryn-mcp-server) (`npm run mcp`) gives Claude, Cursor or any MCP client four tools:

| Tool | What it does | Needs |
|---|---|---|
| `oryn_vault_summary` | Owner, split rules, balances waiting to split, all pay links | nothing |
| `oryn_get_pay_link` | A link's amount, memo and the exact split, from a URL or vault and id | nothing |
| `oryn_pay_link` | Pays a link over x402, capped at the link's amount and a `maxAmount` you set | `ORYN_PAYER_PRIVATE_KEY` |
| `oryn_create_pay_link` | Creates a pay link on your vault as a tagged transaction | `ORYN_OWNER_PRIVATE_KEY` |

So an assistant can do "invoice Marco 25 USA₮ for the logo" or "pay this ORYN link, up to 5 USA₮" end to end, while the money still only moves under the vault's onchain rules.

## Architecture

```
web/ (Vercel, oryn.click)            static pages; read the chain directly with viem
  vault.html  pay.html  proof.html   tagged sends from the user's wallet; x402 signing in the browser
        │
        ▼
x402-service/ (Railway)              pay links as x402 resources on Celo's facilitator
agent/src/ (Railway)                 watcherV2: multicall pending → distribute (tagged)
mcp/server.ts (local)                the same flows as tools for AI agents
        │
        ▼
contracts/ (Celo mainnet)            OrynVaultFactoryV2 → OrynVaultV2 clones (one per owner)
```

There is no database. Vaults, rules and pay links live in the contracts, and every page and tool reads them from the chain.

## Design and user experience

The interface follows the [Celo brand kit](https://celo.org/brand-kit): Gypsum surfaces with Onyx type, Prosperity Yellow calls to action, Forest bands, and accent colours used only as tags. The display face is Fraunces Light, standing in for GT Alpina Thin, which needs a licence. ORYN keeps its own logo.

Payers see the split before they sign. Errors are written in plain words, balances refresh on their own, and the pay page tells a payer exactly what they need if their balance is short.

## Verification and security

- **Tests.** `npm test` runs 19 contract tests: splits, savings, FX guards (spend and receive checks, daily cap, short fills), pay links, clone initialisation, and access control.
- **Locked implementation.** The v2 implementation can't be initialised, and each clone initialises exactly once.
- **The agent can't take money.** See the trust model above, and the tests "never lets the agent withdraw" and "keeps the agent and strangers away from owner powers".
- **Payer protection.** The pay page and the MCP server both refuse links that don't come from ORYN's factory, and cap the x402 signature at exactly the link's amount.
- **Sanctions screening.** The pay page and the x402 service check the payer, and the MCP server checks the vault owner, against [Chainalysis' sanctions oracle](https://celoscan.io/address/0x40C57923924B5c5c5455c48D93317139ADDaC8fb) on Celo before any money moves. The x402 service answers HTTP 451 for a flagged payer.
- **One-sentence links are deterministic.** The sentence parser (`parsePayLinkSentence` in `web/assets/oryn-v2.js`) only fills the form; no model ever computes an amount, and the owner confirms before anything is published.
- **Tag checks.** `npx tsx scripts/verifyTags.ts <txHash>` decodes any transaction and confirms the attribution tag.
- **Payment reports.** `npx tsx scripts/vaultPayments.ts <vault>` lists every USA₮ payment in and split out of a vault.

Our own review of the design, its limits and what we'd fix next: [AUDIT.md](AUDIT.md).

## Build log

- **v1:** cUSD vaults with owner-set rules and an agent that distributes deposits (still live at `/app`).
- **v2 contracts:** multi-currency, balance-based vault clones with mandatory splits, onchain pay links and FX legs through Textile FX; factory deployed to mainnet with a tagged transaction.
- **x402 pay links:** links became x402 resources settled by Celo's facilitator straight into the vault.
- **v2 agent:** multicall watcher for every vault and token, dust floors, and release of queued FX legs.
- **Rebrand:** the whole interface moved to the Celo brand kit.
- **First mainnet payments:** a team test, then the first independent x402 payment, each split by the agent within seconds.
- **Proof page:** every payment and split, live from the chain, with independence signals.
- **MCP server:** ORYN's flows as tools for AI agents.
- **Payer safety and LatAm:** sanctions screening, receipts, the pay page in Spanish and Portuguese, one-sentence pay links, WhatsApp sharing, and private splits (the last asked for by a user on X).

## Quickstart

Requirements: Node 20+, and for the agent a Celo mainnet wallet with a little CELO.

```bash
npm install
npm test                                  # 19 contract tests, no keys needed
cp .env.example .env                      # AGENT_PRIVATE_KEY, X402_API_KEY, ORYN_V2_FACTORY, ...
npm run agent:forever                     # agent (v1 + v2 watchers) and x402-service
npm run mcp                               # the MCP server on stdio
python -m http.server 5173 --directory web   # the web app, then open /vault.html
```

To deploy your own factory: `npx tsx scripts/deployV2.ts --dry-run` to estimate gas, then without `--dry-run` (tagged). Put the address in `ORYN_V2_FACTORY` and in `web/assets/oryn-v2.js`.

Without secrets, everything still runs read-only: the pages read the chain directly, and the MCP server's read tools need no keys.

## Repository layout

```
contracts/
  OrynVaultV2.sol           multi-currency, balance-based vault: split, FX legs, pay links, withdraw
  OrynVaultFactoryV2.sol    one EIP-1167 clone per owner
  OrynVault*.sol            v1 cUSD vaults (still live)
agent/src/
  watcherV2.ts              v2 loop: multicall pending balances, distribute, release queued FX legs
  watcher.ts, executor.ts   v1 loop
  lib/attribution.ts        the single tagged-transaction funnel
  lib/tokens.ts             accepted currencies, their EIP-712 domains, dust floors
x402-service/
  pay.ts                    pay links as x402 resources (GET details, POST to pay)
  server.ts                 x402 resource server on the Celo facilitator
mcp/
  server.ts                 the ORYN MCP server (4 tools)
web/
  vault.html, pay.html, proof.html, index.html
  assets/oryn-v2.js         shared chain reads, wallet, tagged send, x402 signer
scripts/                    deploy, checks, tag verification, payment reports
test/                       contract tests
```

## Documentation

| Document | What's in it |
|---|---|
| [SUBMISSION.md](SUBMISSION.md) | The hackathon entry: description, why USA₮, gas architecture, proof |
| [AGENT.md](AGENT.md) | The agent loop, its trust model, and the MCP server with setup for Claude and Cursor |
| [AUDIT.md](AUDIT.md) | Internal review: threat model, what's enforced onchain, known limits |
| [oryn.click/docs](https://oryn.click/docs) | User guides |

## Risks

- **Unaudited contracts.** The contracts are tested but have not had an external audit. Use amounts you're comfortable with.
- **Agent liveness.** If the agent stops, payments wait safely in the vault as `pending` and the owner can still withdraw; nothing is lost, but splits pause.
- **FX legs.** The agent's Textile quote path isn't built yet; queued FX legs are released in the original currency after 10 minutes.
- **Private splits are a display choice.** The split still runs onchain, so anyone reading the vault contract can work it out. It keeps a subcontractor's rate off the invoice, not off the blockchain.
- **Facilitator dependency.** Gasless payments depend on Celo's x402 facilitator. If it's down, payers can still pay by plain transfer from the same page.

## License

MIT, see [LICENSE](LICENSE).
