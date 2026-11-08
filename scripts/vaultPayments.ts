import "dotenv/config";
import { getAddress, parseAbiItem, formatUnits } from "viem";
import { publicClient } from "../agent/src/lib/celoClient.js";

// Read-only: recent USAT transfers into and out of a vault, with their tx hashes.
// Usage: npx tsx scripts/vaultPayments.ts <vault> [blocks=20000]
const vault = getAddress(process.argv[2]);
const span = BigInt(process.argv[3] ?? 20000);
const USAT = getAddress("0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771");
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const latest = await publicClient.getBlockNumber();
const rows: { block: bigint; dir: string; other: string; amount: string; tx: string }[] = [];
for (let to = latest; to > latest - span; to -= 5000n) {
  const fromBlock = to - 4999n;
  const [inLogs, outLogs] = await Promise.all([
    publicClient.getLogs({ address: USAT, event: transfer, args: { to: vault }, fromBlock, toBlock: to }),
    publicClient.getLogs({ address: USAT, event: transfer, args: { from: vault }, fromBlock, toBlock: to }),
  ]);
  for (const l of inLogs) rows.push({ block: l.blockNumber, dir: "IN ", other: l.args.from!, amount: formatUnits(l.args.value!, 6), tx: l.transactionHash });
  for (const l of outLogs) rows.push({ block: l.blockNumber, dir: "OUT", other: l.args.to!, amount: formatUnits(l.args.value!, 6), tx: l.transactionHash });
}
rows.sort((a, b) => Number(a.block - b.block));
for (const r of rows) {
  const tx = await publicClient.getTransaction({ hash: r.tx as `0x${string}` });
  console.log(`${r.block} ${r.dir} ${r.amount} USAT ${r.dir === "IN " ? "from" : "to"} ${r.other}  sender=${tx.from}  https://celoscan.io/tx/${r.tx}`);
}
if (!rows.length) console.log("no USAT transfers in the last", span.toString(), "blocks");
