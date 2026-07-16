import { spawn } from "node:child_process";

const RESTART_DELAY_MS = 5_000;

function timestamp() {
  return new Date().toISOString();
}

function launch() {
  console.log(`[supervisor] ${timestamp()} starting agent`);
  const child = spawn(process.execPath, ["--import", "tsx", "agent/src/index.ts"], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    console.error(`[supervisor] ${timestamp()} agent exited (code=${code}, signal=${signal}) — restarting in ${RESTART_DELAY_MS}ms`);
    setTimeout(launch, RESTART_DELAY_MS);
  });

  child.on("error", (err) => {
    console.error(`[supervisor] ${timestamp()} failed to spawn agent: ${err.message}`);
  });
}

launch();
