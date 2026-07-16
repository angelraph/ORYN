import { network } from "hardhat";

async function main() {
  const { viem } = await network.getOrCreate();

  const factory = await viem.deployContract("OrynVaultFactory");
  console.log("OrynVaultFactory deployed at:", factory.address);
  console.log("\nAdd this to .env:");
  console.log(`VAULT_FACTORY_ADDRESS=${factory.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
