import { runWatcher } from "./watcher.js";
import { startRetryLoop } from "./lib/x402RetryQueue.js";
import { errMsg } from "./lib/errors.js";

// Log-and-exit rather than continue in a possibly-corrupted state; run-forever.ts
// (the supervisor) restarts the process, which safely re-scans full history on
// startup — so a crash here costs a few seconds, not a missed deposit.
process.on("uncaughtException", (err) => {
  console.error(`[agent] uncaught exception: ${errMsg(err)}`);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error(`[agent] unhandled rejection: ${errMsg(err)}`);
  process.exit(1);
});

startRetryLoop();

runWatcher().catch((err) => {
  console.error(`[agent] fatal error: ${errMsg(err)}`);
  process.exit(1);
});
