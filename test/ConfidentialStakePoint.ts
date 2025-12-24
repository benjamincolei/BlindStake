import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { ConfidentialStakePoint, ConfidentialStakePoint__factory } from "../types";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
};

const STAKE_SCALE = 1_000_000_000_000n;

async function deployFixture() {
  const factory = (await ethers.getContractFactory("ConfidentialStakePoint")) as ConfidentialStakePoint__factory;
  const stakePoint = (await factory.deploy()) as ConfidentialStakePoint;
  const stakePointAddress = await stakePoint.getAddress();

  return { stakePoint, stakePointAddress };
}

describe("ConfidentialStakePoint", function () {
  let signers: Signers;
  let stakePoint: ConfidentialStakePoint;
  let stakePointAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ stakePoint, stakePointAddress } = await deployFixture());
  });

  it("mints confidential balance when staking", async function () {
    const stakeWei = 2n * 10n ** 18n;
    const stakeUnits = stakeWei / STAKE_SCALE;

    const tx = await stakePoint.connect(signers.alice).stake({ value: stakeWei });
    await tx.wait();

    const encryptedBalance = await stakePoint.confidentialBalanceOf(signers.alice.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBalance,
      stakePointAddress,
      signers.alice,
    );

    expect(clearBalance).to.eq(stakeUnits);
  });

  it("burns and finalizes unstake with public decryption proof", async function () {
    const stakeWei = 3n * 10n ** 18n;
    const stakeUnits = stakeWei / STAKE_SCALE;
    const withdrawUnits = 1_000_000n;

    await (await stakePoint.connect(signers.alice).stake({ value: stakeWei })).wait();

    const encryptedAmount = await fhevm
      .createEncryptedInput(stakePointAddress, signers.alice.address)
      .add64(withdrawUnits)
      .encrypt();

    const requestTx = await stakePoint
      .connect(signers.alice)
      ["requestUnstake(bytes32,bytes)"](encryptedAmount.handles[0], encryptedAmount.inputProof);
    const receipt = await requestTx.wait();

    let burntAmount: string | undefined;
    for (const log of receipt!.logs) {
      if (log.address.toLowerCase() !== stakePointAddress.toLowerCase()) {
        continue;
      }
      try {
        const parsed = stakePoint.interface.parseLog(log);
        if (parsed.name === "UnstakeRequested") {
          burntAmount = parsed.args.amount as string;
          break;
        }
      } catch {
        continue;
      }
    }

    expect(burntAmount).to.not.equal(undefined);

    const decryptResult = await fhevm.publicDecrypt([burntAmount!]);
    const clearValue = decryptResult.clearValues[burntAmount! as `0x${string}`] as bigint;

    const contractBalanceBefore = await ethers.provider.getBalance(stakePointAddress);

    await (
      await stakePoint
        .connect(signers.alice)
        .finalizeUnstake(burntAmount!, clearValue, decryptResult.decryptionProof)
    ).wait();

    const contractBalanceAfter = await ethers.provider.getBalance(stakePointAddress);
    expect(contractBalanceBefore - contractBalanceAfter).to.eq(withdrawUnits * STAKE_SCALE);

    const encryptedBalance = await stakePoint.confidentialBalanceOf(signers.alice.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBalance,
      stakePointAddress,
      signers.alice,
    );
    expect(clearBalance).to.eq(stakeUnits - withdrawUnits);
  });

  it("rejects non-scaled stake amounts", async function () {
    await expect(stakePoint.connect(signers.alice).stake({ value: 1n })).to.be.revertedWithCustomError(
      stakePoint,
      "InvalidStakeAmount",
    );
  });
});
