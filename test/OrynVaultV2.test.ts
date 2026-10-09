import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData, parseUnits, zeroAddress, getAddress } from "viem";

const BPS = (pct: number) => Math.round(pct * 100);

type Link = { token: `0x${string}`; amount: bigint; period: number; active: boolean; memo: string };

describe("OrynVaultV2", () => {
  async function deployFixture(opts: { capArs?: bigint } = {}) {
    const { viem } = await network.getOrCreate();
    const [owner, agent, lucia, payer, stranger] = await viem.getWalletClients();

    const wARS = await viem.deployContract("MockERC20Decimals", ["Peso Argentino", "wARS", 18]);
    const usat = await viem.deployContract("MockERC20Decimals", ["Tether America USD", "USAT", 6]);
    const junk = await viem.deployContract("MockERC20Decimals", ["Junk", "JNK", 18]);
    const reactor = await viem.deployContract("MockReactor");

    const factory = await viem.deployContract("OrynVaultFactoryV2", [
      reactor.address,
      agent.account.address,
      [wARS.address, usat.address],
    ]);

    // Lucía (designer) gets 30% in pesos; 20% is saved in dollars; the rest stays in pesos.
    await factory.write.createVault(
      [
        [{ recipient: lucia.account.address, bps: BPS(30), payoutToken: zeroAddress }],
        BPS(20),
        usat.address,
        [wARS.address],
        [opts.capArs ?? parseUnits("1000000", 18)],
      ],
      { account: owner.account },
    );
    const vaultAddress = (await factory.read.vaultOf([owner.account.address])) as `0x${string}`;
    const vault = await viem.getContractAt("OrynVaultV2", vaultAddress);

    await wARS.write.mint([payer.account.address, parseUnits("10000000", 18)]);
    await usat.write.mint([reactor.address, parseUnits("100000", 6)]); // maker inventory

    // An x402 settlement is a plain transfer from the payer straight to payTo (the vault).
    const payViaX402 = (amount: bigint) =>
      wARS.write.transfer([vaultAddress, amount], { account: payer.account });

    const fillData = (sell: bigint, buy: bigint) =>
      encodeFunctionData({
        abi: reactor.abi,
        functionName: "fill",
        args: [wARS.address, sell, usat.address, buy],
      });

    return { viem, owner, agent, lucia, payer, stranger, wARS, usat, junk, reactor, factory, vault, payViaX402, fillData };
  }

  it("refuses to create a vault without a policy", async () => {
    const { factory, stranger } = await deployFixture();
    await assert.rejects(
      factory.write.createVault([[], 0, zeroAddress, [], []], { account: stranger.account }),
    );
  });

  it("splits a plain-transfer (x402) payment: pays Lucía, queues the dollar savings, keeps the rest", async () => {
    const { agent, lucia, wARS, vault, payViaX402 } = await deployFixture();
    const amount = parseUnits("250000", 18);
    await payViaX402(amount);

    assert.equal(await vault.read.pending([wARS.address]), amount);
    await vault.write.distribute([wARS.address], { account: agent.account });

    assert.equal(await wARS.read.balanceOf([lucia.account.address]), parseUnits("75000", 18)); // 30%
    assert.equal(await vault.read.held([wARS.address]), parseUnits("125000", 18)); // 50% kept
    assert.equal(await vault.read.reserved([wARS.address]), parseUnits("50000", 18)); // 20% to convert
    assert.equal(await vault.read.pending([wARS.address]), 0n);
    assert.equal(await vault.read.conversionCount(), 1n);
  });

  it("converts queued savings into dollars only when enough comes back", async () => {
    const { agent, wARS, usat, vault, payViaX402, fillData } = await deployFixture();
    await payViaX402(parseUnits("250000", 18));
    await vault.write.distribute([wARS.address], { account: agent.account });

    const sell = parseUnits("50000", 18);
    const minBuy = parseUnits("40", 6);

    // A quote paying less than minBuy reverts and leaves everything queued.
    await assert.rejects(
      vault.write.convert([0n, minBuy, fillData(sell, parseUnits("39", 6))], { account: agent.account }),
    );
    assert.equal(await vault.read.reserved([wARS.address]), sell);

    await vault.write.convert([0n, minBuy, fillData(sell, parseUnits("41.2", 6))], { account: agent.account });
    assert.equal(await vault.read.held([usat.address]), parseUnits("41.2", 6));
    assert.equal(await vault.read.reserved([wARS.address]), 0n);
    assert.equal(await usat.read.balanceOf([vault.address]), parseUnits("41.2", 6));
    // The conversion can't be replayed.
    await assert.rejects(
      vault.write.convert([0n, 0n, fillData(sell, parseUnits("41.2", 6))], { account: agent.account }),
    );
  });

  it("returns unspent sell amount to the same destination when a quote fills short", async () => {
    const { agent, wARS, usat, vault, payViaX402, fillData } = await deployFixture();
    await payViaX402(parseUnits("250000", 18));
    await vault.write.distribute([wARS.address], { account: agent.account });

    await vault.write.convert(
      [0n, parseUnits("30", 6), fillData(parseUnits("40000", 18), parseUnits("33", 6))],
      { account: agent.account },
    );
    assert.equal(await vault.read.held([usat.address]), parseUnits("33", 6));
    // 125,000 kept + 10,000 the quote didn't use
    assert.equal(await vault.read.held([wARS.address]), parseUnits("135000", 18));
  });

  it("never lets a swap pull a token the vault didn't approve for that conversion", async () => {
    const { agent, wARS, usat, reactor, vault, payViaX402 } = await deployFixture();
    await payViaX402(parseUnits("250000", 18));
    await vault.write.distribute([wARS.address], { account: agent.account });
    const before = await wARS.read.balanceOf([vault.address]);

    const stealData = encodeFunctionData({
      abi: reactor.abi,
      functionName: "steal",
      args: [wARS.address, parseUnits("200000", 18)], // more than the 50,000 earmarked
    });
    await assert.rejects(vault.write.convert([0n, 0n, stealData], { account: agent.account }));
    assert.equal(await wARS.read.balanceOf([vault.address]), before);
    assert.equal(await usat.read.balanceOf([vault.address]), 0n);
  });

  it("enforces the owner's daily conversion cap", async () => {
    const { agent, wARS, vault, payViaX402, fillData } = await deployFixture({ capArs: parseUnits("10000", 18) });
    await payViaX402(parseUnits("250000", 18));
    await vault.write.distribute([wARS.address], { account: agent.account });
    await assert.rejects(
      vault.write.convert([0n, 0n, fillData(parseUnits("50000", 18), parseUnits("41", 6))], { account: agent.account }),
    );
  });

  it("can release a stuck conversion to its destination in the original currency", async () => {
    const { owner, agent, lucia, wARS, usat, vault, payViaX402 } = await deployFixture();
    await vault.write.setPolicy(
      [[{ recipient: lucia.account.address, bps: BPS(30), payoutToken: usat.address }], 0, zeroAddress],
      { account: owner.account },
    );
    await payViaX402(parseUnits("100000", 18));
    await vault.write.distribute([wARS.address], { account: agent.account });
    assert.equal(await wARS.read.balanceOf([lucia.account.address]), 0n); // queued for dollars

    await vault.write.releaseConversion([0n], { account: agent.account });
    assert.equal(await wARS.read.balanceOf([lucia.account.address]), parseUnits("30000", 18));
    assert.equal(await vault.read.reserved([wARS.address]), 0n);
  });

  it("keeps the agent and strangers away from owner powers", async () => {
    const { owner, agent, stranger, wARS, junk, vault, payViaX402, lucia } = await deployFixture();
    await payViaX402(parseUnits("1000", 18));
    await vault.write.distribute([wARS.address], { account: agent.account });

    for (const who of [agent, stranger]) {
      await assert.rejects(vault.write.withdraw([wARS.address, 1n, who.account.address], { account: who.account }));
      await assert.rejects(
        vault.write.setPolicy([[{ recipient: who.account.address, bps: 10000, payoutToken: zeroAddress }], 0, zeroAddress], { account: who.account }),
      );
      await assert.rejects(vault.write.setAcceptedToken([junk.address, true], { account: who.account }));
      await assert.rejects(vault.write.setDailyConvertCap([wARS.address, 1n], { account: who.account }));
      await assert.rejects(vault.write.createLink([wARS.address, 1n, 0, "x"], { account: who.account }));
      await assert.rejects(vault.write.setAgent([who.account.address], { account: who.account }));
    }
    await assert.rejects(vault.write.distribute([wARS.address], { account: stranger.account }));

    // Owner withdraws what's theirs; payouts already made to Lucía are untouched.
    const held = await vault.read.held([wARS.address]);
    await vault.write.withdraw([wARS.address, held, owner.account.address], { account: owner.account });
    assert.equal(await wARS.read.balanceOf([owner.account.address]), held);
    assert.equal(await wARS.read.balanceOf([lucia.account.address]), parseUnits("300", 18));
  });

  it("never lets the owner withdraw amounts earmarked for someone else's conversion", async () => {
    const { owner, agent, lucia, wARS, usat, vault, payViaX402 } = await deployFixture();
    await vault.write.setPolicy(
      [[{ recipient: lucia.account.address, bps: BPS(30), payoutToken: usat.address }], 0, zeroAddress],
      { account: owner.account },
    );
    await payViaX402(parseUnits("100000", 18));
    await vault.write.distribute([wARS.address], { account: agent.account });
    await assert.rejects(
      vault.write.withdraw([wARS.address, parseUnits("100000", 18), owner.account.address], { account: owner.account }),
    );
    await vault.write.withdraw([wARS.address, parseUnits("70000", 18), owner.account.address], { account: owner.account });
  });

  it("validates policies: max 100%, accepted tokens only, real recipients", async () => {
    const { owner, lucia, junk, vault } = await deployFixture();
    const r = lucia.account.address;
    await assert.rejects(vault.write.setPolicy([[{ recipient: r, bps: 9000, payoutToken: zeroAddress }], 2000, zeroAddress], { account: owner.account }));
    await assert.rejects(vault.write.setPolicy([[{ recipient: r, bps: 1000, payoutToken: junk.address }], 0, zeroAddress], { account: owner.account }));
    await assert.rejects(vault.write.setPolicy([[{ recipient: zeroAddress, bps: 1000, payoutToken: zeroAddress }], 0, zeroAddress], { account: owner.account }));
    await assert.rejects(vault.write.setPolicy([[], 0, zeroAddress], { account: owner.account }));
  });

  it("refuses to split tokens the owner never accepted", async () => {
    const { agent, junk, vault, payer } = await deployFixture();
    await junk.write.mint([payer.account.address, 100n]);
    await junk.write.transfer([vault.address, 100n], { account: payer.account });
    await assert.rejects(vault.write.distribute([junk.address], { account: agent.account }));
  });

  it("publishes payment links onchain", async () => {
    const { owner, wARS, usat, vault } = await deployFixture();
    await vault.write.createLink([wARS.address, parseUnits("50000", 18), 0, "Logo design"], { account: owner.account });
    await vault.write.createLink([usat.address, parseUnits("120", 6), 30 * 86400, "Retainer"], { account: owner.account });
    assert.equal(await vault.read.linkCount(), 2n);
    const link = (await vault.read.getLink([1n])) as Link;
    assert.equal(getAddress(link.token), getAddress(usat.address));
    assert.equal(link.amount, parseUnits("120", 6));
    assert.equal(link.period, 30 * 86400);
    assert.equal(link.active, true);
    assert.equal(link.memo, "Retainer");
    await vault.write.setLinkActive([0n, false], { account: owner.account });
    assert.equal(((await vault.read.getLink([0n])) as Link).active, false);
  });
});
