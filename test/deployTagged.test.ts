import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { concatHex, encodeDeployData, getAddress } from "viem";
import { toDataSuffix } from "@celo/attribution-tags";

// Contract creation through the tagged funnel appends an ERC-8021 suffix after the initcode.
// Solidity reads constructor args from the tail of the initcode, so prove the suffix doesn't
// corrupt them before doing it on mainnet.
describe("tagged contract deployment", () => {
  it("deploys OrynVaultFactoryV2 with an attribution suffix and intact constructor args", async () => {
    const { viem } = await network.getOrCreate();
    const [deployer] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const artifact = await import("../artifacts/contracts/OrynVaultFactoryV2.sol/OrynVaultFactoryV2.json", { with: { type: "json" } });

    const reactor = getAddress("0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3");
    const tokens = [getAddress("0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D"), getAddress("0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771")];
    const data = encodeDeployData({ abi: artifact.default.abi, bytecode: artifact.default.bytecode as `0x${string}`, args: [reactor, deployer.account.address, tokens] });

    const hash = await deployer.sendTransaction({ data: concatHex([data, toDataSuffix("celo_test_tag")]) });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");

    const factory = await viem.getContractAt("OrynVaultFactoryV2", receipt.contractAddress!);
    assert.equal(getAddress((await factory.read.swapTarget()) as string), reactor);
    assert.equal(getAddress((await factory.read.defaultAgent()) as string), getAddress(deployer.account.address));
    assert.deepEqual(((await factory.read.defaultTokens()) as string[]).map((t) => getAddress(t)), tokens);
  });
});
