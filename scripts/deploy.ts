import { network } from "hardhat";

async function main() {
  const { viem } = await network.getOrCreate();

  const factory = await viem.deployContract("OrynVaultFactory");
  const publicClient = await viem.getPublicClient();
  const deployBlock = await publicClient.getBlockNumber();

  console.log("OrynVaultFactory deployed at:", factory.address);
  console.log("\nAdd this to .env:");
  console.log(`VAULT_FACTORY_ADDRESS=${factory.address}`);
  console.log(`VAULT_FACTORY_DEPLOY_BLOCK=${deployBlock}`);
  console.log(
    "\n(deployBlock is read right after confirmation — if you want the exact first block, run scripts/findDeployBlock.ts against the address.)",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
