import { runWatcher } from "./watcher.js";

runWatcher().catch((err) => {
  console.error("[agent] fatal error:", err);
  process.exit(1);
});
