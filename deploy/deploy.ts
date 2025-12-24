import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedStakePoint = await deploy("ConfidentialStakePoint", {
    from: deployer,
    log: true,
  });

  console.log(`ConfidentialStakePoint contract: `, deployedStakePoint.address);
};
export default func;
func.id = "deploy_confidential_stake_point"; // id required to prevent reexecution
func.tags = ["ConfidentialStakePoint"];
