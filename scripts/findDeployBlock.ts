import "dotenv/config";
import { publicClient } from "../agent/src/lib/celoClient.js";

const ADDRESS = process.argv[2] as `0x${string}` | undefined;
if (!ADDRESS) throw new Error("Usage: tsx scripts/findDeployBlock.ts <address>");

async function hasCodeAt(blockNumber: bigint): Promise<boolean> {
  const code = await publicClient.getBytecode({ address: ADDRESS!, blockNumber });
  return !!code && code !== "0x";
}

async function main() {
  const latest = await publicClient.getBlockNumber();
  const isDeployedAtLatest = await hasCodeAt(latest);
  if (!isDeployedAtLatest) throw new Error("No code at this address at the latest block");

  let lo = 0n;
  let hi = latest;
  // Invariant: hasCodeAt(hi) === true, hasCodeAt(lo) === false (or lo == 0 and unknown)
  while (lo < hi) {
    const mid = lo + (hi - lo) / 2n;
    if (await hasCodeAt(mid)) {
      hi = mid;
    } else {
      lo = mid + 1n;
    }
  }

  console.log("First block with code:", hi.toString());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
