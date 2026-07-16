import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { categorizeDistribution } from "../../../x402-service/client.js";
import { errMsg } from "./errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = join(__dirname, "../../../data/x402-retry-queue.json");
const RETRY_INTERVAL_MS = 2 * 60_000; // 2 minutes
const MAX_ATTEMPTS = 50; // ~100 minutes of retrying before giving up

interface RetryItem {
  vault: `0x${string}`;
  recipient: `0x${string}`;
  amount: string;
  attempts: number;
  createdAt: string;
}

let queue: RetryItem[] = [];

function load() {
  if (existsSync(QUEUE_FILE)) {
    try {
      queue = JSON.parse(readFileSync(QUEUE_FILE, "utf-8"));
    } catch (err) {
      console.error(`[x402-retry] failed to load queue file, starting empty: ${errMsg(err)}`);
      queue = [];
    }
  }
}

function save() {
  mkdirSync(dirname(QUEUE_FILE), { recursive: true });
  writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

load();

/**
 * Queues a failed x402 categorization for retry, persisted to disk so a process
 * restart (the supervisor restarts on any crash) can't silently lose it — the
 * watcher's history replay only re-processes undistributed deposits, so this is
 * otherwise the only path back to a categorization that failed transiently
 * (e.g. the facilitator's relayer being temporarily out of gas).
 */
export function enqueueRetry(item: Omit<RetryItem, "attempts" | "createdAt">) {
  queue.push({ ...item, attempts: 0, createdAt: new Date().toISOString() });
  save();
  console.log(`[x402-retry] queued ${item.recipient} for retry (${queue.length} pending)`);
}

async function retryOnce() {
  if (queue.length === 0) return;

  const remaining: RetryItem[] = [];
  for (const item of queue) {
    try {
      const result = await categorizeDistribution({
        vault: item.vault,
        recipient: item.recipient,
        amount: item.amount,
      });
      console.log(`[x402-retry] succeeded for ${item.recipient} after ${item.attempts + 1} attempt(s): ${result.category}`);
    } catch (err) {
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        console.error(`[x402-retry] giving up on ${item.recipient} after ${attempts} attempts: ${errMsg(err)}`);
      } else {
        console.error(`[x402-retry] attempt ${attempts} failed for ${item.recipient}: ${errMsg(err)}`);
        remaining.push({ ...item, attempts });
      }
    }
  }
  queue = remaining;
  save();
}

export function startRetryLoop() {
  async function tick() {
    try {
      await retryOnce();
    } catch (err) {
      console.error(`[x402-retry] tick error: ${errMsg(err)}`);
    } finally {
      setTimeout(tick, RETRY_INTERVAL_MS);
    }
  }
  setTimeout(tick, RETRY_INTERVAL_MS);
  if (queue.length > 0) {
    console.log(`[x402-retry] resuming with ${queue.length} pending item(s) from a previous run`);
  }
}
