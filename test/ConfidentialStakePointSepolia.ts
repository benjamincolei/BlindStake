import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, deployments } from "hardhat";
import { expect } from "chai";
import { ConfidentialStakePoint } from "../types";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  alice: HardhatEthersSigner;
};

describe("ConfidentialStakePointSepolia", function () {
  let signers: Signers;
  let stakePoint: ConfidentialStakePoint;
  let stakePointAddress: string;

  before(async function () {
    if (fhevm.isMock) {
      console.warn(`This hardhat test suite can only run on Sepolia Testnet`);
      this.skip();
    }

    try {
      const deployment = await deployments.get("ConfidentialStakePoint");
      stakePointAddress = deployment.address;
      stakePoint = await ethers.getContractAt("ConfidentialStakePoint", stakePointAddress);
    } catch (error) {
      (error as Error).message += ". Call 'npx hardhat deploy --network sepolia'";
      throw error;
    }

    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { alice: ethSigners[0] };
  });

  it("stakes and decrypts balance", async function () {
    this.timeout(4 * 60000);

    const stakeScale = await stakePoint.STAKE_SCALE();
    const stakeWei = 1_000_000_000_000_000n;
    const stakeUnits = stakeWei / stakeScale;

    const encryptedBalanceBefore = await stakePoint.confidentialBalanceOf(signers.alice.address);
    const balanceBefore =
      encryptedBalanceBefore === ethers.ZeroHash
        ? 0n
        : await fhevm.userDecryptEuint(
            FhevmType.euint64,
            encryptedBalanceBefore,
            stakePointAddress,
            signers.alice,
          );

    await (await stakePoint.connect(signers.alice).stake({ value: stakeWei })).wait();

    const encryptedBalanceAfter = await stakePoint.confidentialBalanceOf(signers.alice.address);
    const balanceAfter = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBalanceAfter,
      stakePointAddress,
      signers.alice,
    );

    expect(balanceAfter - balanceBefore).to.eq(stakeUnits);
  });
});
