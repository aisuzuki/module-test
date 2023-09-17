// deploy ERC 20 token
import { ethers } from "hardhat";
import { Contract } from "@ethersproject/contracts";
import { AddressZero } from "@ethersproject/constants";
import { logGas } from "@gnosis.pm/safe-contracts/";

import testERC20TokenCompiled from "@gnosis.pm/safe-contracts/build/artifacts/contracts/test/ERC20Token.sol/ERC20Token.json";
import gnosisSafeCompiled from "@gnosis.pm/safe-contracts/build/artifacts/contracts/GnosisSafe.sol/GnosisSafe.json";
import gnosisSafeProxyFactoryCompiled from "@gnosis.pm/safe-contracts/build/artifacts/contracts/proxies/GnosisSafeProxyFactory.sol/GnosisSafeProxyFactory.json";
import compatibilityFallbackHandlerCompiled from "@gnosis.pm/safe-contracts/build/artifacts/contracts/handler/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json";

export async function getSafeMasterCopy(): Promise<Contract> {
    const masterCopyContractFactory = await ethers.getContractFactory(gnosisSafeCompiled.abi, gnosisSafeCompiled.bytecode);
    const masterCopy = await masterCopyContractFactory.deploy();
    return masterCopy.deployed();
}

export async function getSafeFactory(): Promise<Contract> {
    const factoryContractFactory = await ethers.getContractFactory(
        gnosisSafeProxyFactoryCompiled.abi,
        gnosisSafeProxyFactoryCompiled.bytecode,
    );
    const factory = await factoryContractFactory.deploy();
    return factory.deployed();
}

export async function createGnosisSafeInstance(): Promise<Contract> {
    const salt = Math.floor(Math.random() * (Number.MAX_SAFE_INTEGER - 0 + 1)) + 0;
    const masterCopy = await getSafeMasterCopy();
    const factory = await getSafeFactory();
    const template = await factory.callStatic.createProxyWithNonce(masterCopy.address, "0x", salt);
    await factory.createProxyWithNonce(masterCopy.address, "0x", salt).then((tx: any) => tx.wait());
    //    const template = await factory.callStatic.createProxy(masterCopy.address, "0x")
    //    await factory.createProxy(masterCopy.address, "0x").then((tx: any) => tx.wait())
    const safe = await ethers.getContractFactory(gnosisSafeCompiled.abi, gnosisSafeCompiled.bytecode);
    return safe.attach(template);
}

export async function createGnosisSafeInstanceWithOwners(
    owners: string[],
    threshold?: number,
    fallbackHandler?: string,
    logGasUsage?: boolean,
) {
    const safe = await createGnosisSafeInstance();
    await logGas(
        `Setup Safe with ${owners.length} owner(s)${fallbackHandler && fallbackHandler !== AddressZero ? " and fallback handler" : ""}`,
        safe.setup(owners, threshold || owners.length, AddressZero, "0x", fallbackHandler || AddressZero, AddressZero, 0, AddressZero),
        !logGasUsage,
    );
    return safe;
}

export async function createCompatibilityFallbackHandler() {
    return ethers.getContractFactory(compatibilityFallbackHandlerCompiled.abi, compatibilityFallbackHandlerCompiled.bytecode);
}

export async function createCompatibilityFallbackHandlerInstance() {
    const handlerContract = await createCompatibilityFallbackHandler();
    const handler = await handlerContract.deploy();
    return handler.deployed();
}

/**
 * Deploy TokenTransferModule
 *
 * @note I personally prefer module to be upgradable, and deploy it as proxy.
 *       To simplify codes, I will not use proxy factory here.
 *
 * @param safeAddress
 * @param tokenAddress
 */
export async function deployTokenTransferModule(): Promise<Contract> {
    const module = await ethers.getContractFactory("TokenTransferModule");
    const instance = await module.deploy();
    return instance.deployed();
}

export async function deployERC20Token(): Promise<Contract> {
    const token = await ethers.getContractFactory(testERC20TokenCompiled.abi, testERC20TokenCompiled.bytecode);
    const instance = await token.deploy();
    return instance.deployed();
}
