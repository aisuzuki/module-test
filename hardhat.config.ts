import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "hardhat-gas-reporter";
import "solidity-docgen";


const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      { 
        version: "0.8.21",
        settings: {
          // See the solidity docs for advice about optimization and evmVersion
          optimizer: {
            enabled: true,
            runs: 200,
            details: {
              yul: true,
              yulDetails: {
                stackAllocation: true,
              },
            }
          }
        },
      }
    ]
  },
  gasReporter: {
    enabled: true
  },
};

export default config;
