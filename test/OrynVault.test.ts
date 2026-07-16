import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseUnits } from "viem";

describe("OrynVault", () => {
  async function deployFixture() {
    const { viem } = await network.getOrCreate();
    const [owner, recipientA, recipientB, other] = await viem.getWalletClients();

    const token = await viem.deployContract("MockERC20", ["Mock cUSD", "mcUSD"]);
    const factory = await viem.deployContract("OrynVaultFactory");

    await factory.write.createVault([token.address, owner.account.address], { account: owner.account });

    const vaultAddress = (await factory.read.vaultOf([owner.account.address])) as `0x${string}`;
    const vault = await viem.getContractAt("OrynVault", vaultAddress);

    await token.write.mint([other.account.address, parseUnits("1000", 18)]);

    return { viem, owner, recipientA, recipientB, other, token, factory, vault };
  }

  it("splits a deposit per the owner's rules and keeps the remainder as savings", async () => {
    const { owner, recipientA, recipientB, other, token, vault } = await deployFixture();

    await vault.write.setRules(
      [
        [
          { recipient: recipientA.account.address, bps: 2000 }, // 20%
          { recipient: recipientB.account.address, bps: 3000 }, // 30%
        ],
      ],
      { account: owner.account },
    );

    const depositAmount = parseUnits("100", 18);
    await token.write.approve([vault.address, depositAmount], { account: other.account });
    await vault.write.deposit([depositAmount], { account: other.account });

    await vault.write.distribute([], { account: owner.account });

    assert.equal(await token.read.balanceOf([recipientA.account.address]), parseUnits("20", 18));
    assert.equal(await token.read.balanceOf([recipientB.account.address]), parseUnits("30", 18));
    assert.equal(await vault.read.savingsBalance(), parseUnits("50", 18));
    assert.equal(await vault.read.pendingBalance(), 0n);
  });

  it("only lets the agent or owner trigger distribute()", async () => {
    const { other, token, vault } = await deployFixture();

    const depositAmount = parseUnits("10", 18);
    await token.write.approve([vault.address, depositAmount], { account: other.account });
    await vault.write.deposit([depositAmount], { account: other.account });

    await assert.rejects(vault.write.distribute([], { account: other.account }));
  });

  it("never lets the agent withdraw — only the owner can", async () => {
    const { owner, other, token, vault } = await deployFixture();

    const depositAmount = parseUnits("10", 18);
    await token.write.approve([vault.address, depositAmount], { account: other.account });
    await vault.write.deposit([depositAmount], { account: other.account });
    await vault.write.distribute([], { account: owner.account }); // no rules set -> all goes to savings

    await assert.rejects(
      vault.write.withdraw([parseUnits("10", 18), other.account.address], { account: other.account }),
    );

    await vault.write.withdraw([parseUnits("10", 18), owner.account.address], { account: owner.account });
    assert.equal(await token.read.balanceOf([owner.account.address]), parseUnits("10", 18));
  });

  it("rejects rules that sum past 100%", async () => {
    const { owner, recipientA, recipientB, vault } = await deployFixture();

    await assert.rejects(
      vault.write.setRules(
        [
          [
            { recipient: recipientA.account.address, bps: 6000 },
            { recipient: recipientB.account.address, bps: 5000 },
          ],
        ],
        { account: owner.account },
      ),
    );
  });
});
