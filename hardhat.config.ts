import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import "dotenv/config";

const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY ?? "0x" + "11".repeat(32);

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    celo: {
      type: "http",
      url: process.env.CELO_RPC_URL ?? "https://forno.celo.org",
      chainId: 42220,
      accounts: [AGENT_PRIVATE_KEY],
    },
    celoSepolia: {
      type: "http",
      url: "https://forno.celo-sepolia.celo-testnet.org",
      chainId: 11142220,
      accounts: [AGENT_PRIVATE_KEY],
    },
  },
};

export default config;
