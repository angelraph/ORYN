# The ORYN agent

ORYN has two agent surfaces: the **autonomous agent** that splits every payment, and the **MCP server** that lets other AI agents use ORYN as a tool.

## The autonomous agent

| | |
|---|---|
| Code | [`agent/src/watcherV2.ts`](agent/src/watcherV2.ts) (v2), [`agent/src/watcher.ts`](agent/src/watcher.ts) (v1) |
| Runs on | Railway, service `oryn-agent`, under one supervisor with the x402 service (`npm run agent:forever`) |
| Wallet | [`0xeae6959bE76b5f2ad2142A6fe5E4Cf4F9Ca45d26`](https://celoscan.io/address/0xeae6959bE76b5f2ad2142A6fe5E4Cf4F9Ca45d26) |
| Identity | ERC-8004 [agentId 9688](https://8004scan.io/agents/celo/9688) |
| Attribution | Every transaction goes through [`sendTaggedTransaction`](agent/src/lib/attribution.ts), which appends `celo_4781ba9a079a` |

### The loop

Every 15 seconds:

1. Read `vaultCount()` and `allVaults(i)` from the factory to find new vaults.
2. Every 5 minutes, refresh each vault's accepted `tokens()`.
3. Multicall `pending(token)` for every vault and token pair.
4. For each pair at or above the token's dust floor (about 5 US cents), call `distribute(token)` as a tagged transaction.
5. Release FX legs that have been queued longer than `ORYN_V2_RELEASE_AFTER_MS` (default 10 minutes) to their recipient in the original currency.

If `ORYN_V2_FACTORY` isn't set, the v2 loop does nothing, so the agent can run v1 only.

### Trust model

What the agent can do, enforced by `OrynVaultV2.sol`:

| Action | Agent | Owner |
|---|---|---|
| `distribute(token)` (run the owner's split) | ✅ | ✅ |
| Release a queued FX leg to its own recipient | ✅ | ✅ |
| `convert` through the single allow-listed swap target, within the owner's daily cap | ✅ | ✅ |
| Withdraw | ❌ | ✅ |
| Change the split, tokens, cap or agent | ❌ | ✅ |
| Create or switch off pay links | ❌ | ✅ |

The worst a compromised agent key can do is run splits the owner already chose, or convert within the owner's daily cap through the one swap contract the factory allows, where onchain checks require enough to come back.

### Cost

A `distribute()` costs the agent a fraction of a cent of CELO. The dust floor stops a stream of tiny transfers from making the agent spend more on gas than the split is worth.

## The ORYN MCP server

[`mcp/server.ts`](mcp/server.ts) exposes ORYN's flows as [Model Context Protocol](https://modelcontextprotocol.io) tools, so Claude, Cursor or any MCP client can use ORYN directly.

### Tools

| Tool | Input | What it does |
|---|---|---|
| `oryn_vault_summary` | `address` (vault or owner wallet) | Owner, split rules, balances waiting to split, and every pay link with its URL |
| `oryn_get_pay_link` | `url`, or `vault` + `linkId` | The link's amount, memo, type, and exactly how a payment will be split |
| `oryn_pay_link` | `url` or `vault` + `linkId`, and `maxAmount` | Pays the link over x402 on Celo. The wallet only signs; Celo's facilitator settles and pays gas. Refuses if the link isn't from ORYN's factory, is switched off, asks for more than `maxAmount`, or the wallet is short. The signature is capped at exactly the link's amount, in that token only |
| `oryn_create_pay_link` | `currency`, `amount`, `memo`, `type` | Creates a link on the owner's vault as one tagged transaction and returns the shareable URL |

The read tools need no keys. Keys for the write tools stay on the machine running the server.

### Setup

```bash
npm install
```

Then add it to your MCP client. For Claude Desktop (`claude_desktop_config.json`) or Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "oryn": {
      "command": "npx",
      "args": ["tsx", "/path/to/ORYN/mcp/server.ts"],
      "env": {
        "ORYN_PAYER_PRIVATE_KEY": "0x… (optional: a wallet with USA₮, to pay links)",
        "ORYN_OWNER_PRIVATE_KEY": "0x… (optional: your vault owner key, to create links)"
      }
    }
  }
}
```

For Claude Code: `claude mcp add oryn -- npx tsx /path/to/ORYN/mcp/server.ts`.

### Example

> **You:** What does this link want? https://oryn.click/pay?v=0x1b250e0933E441616Dd81977eF31eC7e2Fff51Bb&l=1
>
> **Assistant** (calls `oryn_get_pay_link`): It asks for 1 USA₮ for "Support Oryn". 0.9 goes to `0x7A20…072a` and 0.1 stays in the vault as savings.
>
> **You:** Pay it, up to 1 USA₮.
>
> **Assistant** (calls `oryn_pay_link` with `maxAmount: "1"`): Paid. Settlement: celoscan.io/tx/0x…. ORYN's agent will split it within about 15 seconds; it'll appear on oryn.click/proof.

Optional environment: `ORYN_API` (x402 service URL), `ORYN_V2_FACTORY`, `ATTRIBUTION_TAG`. They default to ORYN's mainnet deployment.
