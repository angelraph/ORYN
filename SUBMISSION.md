# ORYN: Agents on Open Rails submission

Draft text for the loops.house entry and the X post. Fill the two `TODO`s once real payments exist.

## Entry fields

- **Project:** ORYN
- **One-liner:** Pay links that settle USA₮ gasless over x402 and split themselves onchain on Celo.
- **Primary track:** Stable Agents: Open Corridors, USA₮ with x402
- **Repo:** https://github.com/angelraph/ORYN (public)
- **App:** https://oryn.click/vault · pay page https://oryn.click/pay
- **ERC-8004 identity:** https://8004scan.io/agents/celo/9688
- **Agent wallet:** 0xeae6959bE76b5f2ad2142A6fe5E4Cf4F9Ca45d26
- **PayTo wallets:** x402 pay links settle with `payTo` = the owner's own OrynVaultV2 clone. Every v2 vault is created by factory 0x229b68DbAC7d53497eAd2981f95d5dF2cE9fFA50 and listed by `allVaults()`. TODO: list the vault addresses that received payments.
- **Contracts we deployed:** OrynVaultFactoryV2 0x229b68DbAC7d53497eAd2981f95d5dF2cE9fFA50 (implementation 0x2348B97e2527C030aE983Ca0e763dD26E2BEb4D3); v1 factory 0xcb45e24d147262302b6e7dac579e8ae4d879ef19
- **Attribution tag:** celo_4781ba9a079a

## Description

ORYN is an autonomous treasury agent for freelancers and small merchants. You create a vault once and decide how every payment is divided, for example 30% to a collaborator, 20% saved, the rest yours. Then you share a pay link.

Your client opens oryn.click/pay, sees exactly how their payment will be split, and pays in USA₮ with one signature: no gas and no CELO needed. Celo's x402 facilitator settles it straight into the owner's vault. ORYN's agent reads every vault's pending balances each 15 seconds and executes the split as a tagged mainnet transaction. Another agent can pay the same link, because it's a standard x402 resource.

**Why USA₮:** the people ORYN serves invoice clients abroad and want to be paid in dollars, without asking those clients to hold CELO for gas or learn a new chain. USA₮ settles over x402 with an EIP-3009 authorisation, so the payer only signs. The same vault also accepts wARS, wBRL and wCOP (Permit2 with EIP-2612 gas sponsoring) for local-currency corridors.

**Non-custodial:** the agent can only split, release a queued leg to its own recipient, or convert through one allow-listed swap contract under an owner-set daily cap. It can never withdraw or change the split. This is enforced in OrynVaultV2.sol.

**Gas architecture (as asked):** x402 settlements are relayed by Celo's facilitator, and that gas is not ours. ORYN's agent wallet pays its own gas for every `distribute()` and release call, all tagged. Owners pay their own gas for vault setup, pay links and withdrawals, also tagged. A payer who uses the regular-transfer fallback signs and pays their own gas, and that transfer carries the tag too.

**Proof:** TODO: Celoscan links to x402 settlements from independent wallets into ORYN vaults, and the agent's matching `distribute()` transactions.

## X post (tag @CeloDevs and @Celo)

> Get paid in dollars, split on arrival.
>
> ORYN pay links settle USA₮ over x402 on @Celo: your client signs once, pays no gas, and the money lands in your own vault. Our agent splits it onchain in seconds: collaborators paid, savings set aside.
>
> Built for Agents on Open Rails @CeloDevs
> https://oryn.click
