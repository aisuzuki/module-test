import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "hardhat-gas-reporter"

const config: HardhatUserConfig = {
  solidity: "0.8.21",
  gasReporter: {
    enabled: true
  },
};

export default config;
