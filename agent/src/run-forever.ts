import { spawn } from "node:child_process";

const RESTART_DELAY_MS = 5_000;

function timestamp() {
  return new Date().toISOString();
}

// The executor calls out to the x402 categorization service over HTTP (localhost by
// default — see x402-service/client.ts). Railway only runs this one process, so that
// service has to be supervised here too, or every x402 payment fails with
// "fetch failed" because nothing is listening on the port.
const PROCESSES = [
  { name: "agent", entry: "agent/src/index.ts" },
  { name: "x402-service", entry: "x402-service/server.ts" },
];

function launch(proc: { name: string; entry: string }) {
  console.log(`[supervisor] ${timestamp()} starting ${proc.name}`);
  const child = spawn(process.execPath, ["--import", "tsx", proc.entry], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    console.error(`[supervisor] ${timestamp()} ${proc.name} exited (code=${code}, signal=${signal}) — restarting in ${RESTART_DELAY_MS}ms`);
    setTimeout(() => launch(proc), RESTART_DELAY_MS);
  });

  child.on("error", (err) => {
    console.error(`[supervisor] ${timestamp()} failed to spawn ${proc.name}: ${err.message}`);
  });
}

for (const proc of PROCESSES) launch(proc);
