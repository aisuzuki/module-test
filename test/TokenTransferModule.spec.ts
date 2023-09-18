import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { config, ethers } from "hardhat";
import { AddressOne, buildSafeTransaction, buildSignatureBytes, signHash } from "@gnosis.pm/safe-contracts";
import { AddressZero } from "@ethersproject/constants";
import { BigNumber } from "@ethersproject/bignumber";
import { defaultAbiCoder } from "@ethersproject/abi";
import { ecsign, toBuffer } from "ethereumjs-util";
import {
    createCompatibilityFallbackHandlerInstance,
    createCompatibilityFallbackHandler,
    createGnosisSafeInstanceWithOwners,
    deployERC20Token,
    deployTokenTransferModule,
} from "./utils/setup";
import {
    TokenTransferApproval,
    executeContractCallWithSigners,
    executeTxWithSigners,
    getErrorMessage,
    tokenTransferSignTypedData,
} from "./utils/execution";

describe("TokenTransferModule", function () {
    async function deployWalletFixture() {
        const [owner1, owner2, tokenReceiver, executor] = await ethers.getSigners();
        const safe = await createGnosisSafeInstanceWithOwners([owner1.address], 1);
        const erc20Contract = await deployERC20Token();

        return { owner1, owner2, tokenReceiver, executor, safe, erc20Contract };
    }

    async function deployWalletWithModuleFixture() {
        const [owner1, owner2, tokenReceiver, executor] = await ethers.getSigners();
        const safe = await createGnosisSafeInstanceWithOwners([owner1.address], 1);
        const erc20Contract = await deployERC20Token();

        // fund token
        await erc20Contract.transfer(safe.address, 10);

        const module = await deployTokenTransferModule();
        await executeContractCallWithSigners(safe, module, "setup", [erc20Contract.address], [owner1]);
        await executeContractCallWithSigners(safe, safe, "enableModule", [module.address], [owner1]);
        return { owner1, owner2, tokenReceiver, executor, safe, erc20Contract, module };
    }

    async function deployWalletWithModuleForContracgSignatureFixture() {
        const handler = await createCompatibilityFallbackHandlerInstance();

        const [signerSafeOwner, owner1, tokenReceiver, executor] = await ethers.getSigners();
        const signerSafe = await createGnosisSafeInstanceWithOwners([signerSafeOwner.address], 1, handler.address);

        const safe = await createGnosisSafeInstanceWithOwners([owner1.address, signerSafe.address], 1);

        const erc20Contract = await deployERC20Token();
        // fund token
        await erc20Contract.transfer(safe.address, 10);

        const module = await deployTokenTransferModule();
        await executeContractCallWithSigners(safe, module, "setup", [erc20Contract.address], [owner1]);
        await executeContractCallWithSigners(safe, safe, "enableModule", [module.address], [owner1]);
        const messageHandler = (await createCompatibilityFallbackHandler()).attach(signerSafe.address);
        return { owner1, signerSafeOwner, tokenReceiver, executor, safe, signerSafe, erc20Contract, module, messageHandler };
    }

    describe("Deployment", function () {
        it("Should fail to setup module if ERC20 token address is invalid (address zero)", async function () {
            const { owner1, safe } = await loadFixture(deployWalletFixture);

            const module = await deployTokenTransferModule();
            await expect(executeContractCallWithSigners(safe, module, "setup", [AddressZero], [owner1])).to.be.revertedWith("GS013");

            const abi = ["function setup(address)"];
            const abiif = new ethers.utils.Interface(abi);
            const data = abiif.encodeFunctionData("setup", [AddressZero]);
            await expect(getErrorMessage(module.address, BigNumber.from(0), data, safe.address)).to.be.revertedWithCustomError(
                module,
                "InvalidAddress",
            );
        });

        it("Should fail to setup module if ERC20 token address is invalid (address one)", async function () {
            const { owner1, safe } = await loadFixture(deployWalletFixture);

            const module = await deployTokenTransferModule();
            await expect(executeContractCallWithSigners(safe, module, "setup", [AddressOne], [owner1])).to.be.revertedWith("GS013");

            const abi = ["function setup(address)"];
            const abiif = new ethers.utils.Interface(abi);
            const data = abiif.encodeFunctionData("setup", [AddressOne]);
            await expect(getErrorMessage(module.address, BigNumber.from(0), data, safe.address)).to.be.revertedWithCustomError(
                module,
                "InvalidAddress",
            );
        });

        it("Should fail to setup if module is already initialized", async function () {
            const { owner1, safe, erc20Contract } = await loadFixture(deployWalletFixture);

            const module = await deployTokenTransferModule();
            await executeContractCallWithSigners(safe, module, "setup", [erc20Contract.address], [owner1]);
            await expect(executeContractCallWithSigners(safe, module, "setup", [erc20Contract.address], [owner1])).to.be.revertedWith(
                "GS013",
            );

            const abi = ["function setup(address)"];
            const abiif = new ethers.utils.Interface(abi);
            const data = abiif.encodeFunctionData("setup", [erc20Contract.address]);
            await expect(getErrorMessage(module.address, BigNumber.from(0), data, safe.address)).to.be.revertedWithCustomError(
                module,
                "ModuleAlreadyInitialized",
            );
        });

        it("Should setup and enable module", async function () {
            const { owner1, safe, erc20Contract } = await loadFixture(deployWalletFixture);

            const module = await deployTokenTransferModule();
            await executeContractCallWithSigners(safe, module, "setup", [erc20Contract.address], [owner1]);
            await executeContractCallWithSigners(safe, safe, "enableModule", [module.address], [owner1]);

            await expect(await safe.isModuleEnabled(module.address)).to.be.true;
            await expect(await module.token()).to.be.deep.eq(erc20Contract.address);
            await expect(await module.NAME()).to.be.deep.eq("TokenTransferModule");
            await expect(await module.VERSION()).to.be.deep.eq("1.0.0");
        });
    });

    describe("Get token transfer approval hash to be signed", function () {
        it("Should fail getTokenTransferApprovalHash if caller is not owner of safe contract", async function () {
            const { owner2, tokenReceiver, module } = await loadFixture(deployWalletWithModuleFixture);

            await expect(module.connect(owner2).getTokenTransferApprovalHash(tokenReceiver.address, 1)).to.be.revertedWithCustomError(
                module,
                "OnlyOwner",
            );
        });

        it("Should fail if to address is invalid (address zero)", async function () {
            const { owner1, module } = await loadFixture(deployWalletWithModuleFixture);

            await expect(module.connect(owner1).getTokenTransferApprovalHash(AddressZero, 1)).to.be.revertedWithCustomError(
                module,
                "InvalidAddress",
            );
        });

        it("Should fail if to address is invalid (address one)", async function () {
            const { owner1, module } = await loadFixture(deployWalletWithModuleFixture);

            await expect(module.connect(owner1).getTokenTransferApprovalHash(AddressOne, 1)).to.be.revertedWithCustomError(
                module,
                "InvalidAddress",
            );
        });

        it("Should fail if balance of token is insufficient", async function () {
            const { owner1, safe, module } = await loadFixture(deployWalletWithModuleFixture);

            await expect(module.connect(owner1).getTokenTransferApprovalHash(safe.address, 11))
                .to.be.revertedWithCustomError(module, "InsufficientBalance")
                .withArgs(10);
        });
    });

    describe("Transfer token with owner's approval", function () {
        it("Should fail if hash data is mismatched (token receiver)", async function () {
            const { owner1, owner2, tokenReceiver, executor, module } = await loadFixture(deployWalletWithModuleFixture);

            const hash = await module.connect(owner1).getTokenTransferApprovalHash(tokenReceiver.address, 1);
            const signature = await signHash(owner1, hash);

            // invalid owner (checkSignature fails)
            await expect(module.connect(executor).transferToken(owner2.address, 1, signature.data)).to.be.rejectedWith("GS026");
        });

        it("Should fail if hash data is mismatched (token amount)", async function () {
            const { owner1, tokenReceiver, executor, module } = await loadFixture(deployWalletWithModuleFixture);

            const hash = await module.connect(owner1).getTokenTransferApprovalHash(tokenReceiver.address, 1);
            const signature = await signHash(owner1, hash);

            // invalid owner (checkSignature fails)
            await expect(module.connect(executor).transferToken(tokenReceiver.address, 2, signature.data)).to.be.rejectedWith("GS026");
        });

        it("Should fail if hash is signed by non-owner", async function () {
            const { owner1, owner2, tokenReceiver, executor, module } = await loadFixture(deployWalletWithModuleFixture);

            const hash = await module.connect(owner1).getTokenTransferApprovalHash(tokenReceiver.address, 1);
            const signature = await signHash(owner2, hash);

            // invalid owner
            await expect(module.connect(executor).transferToken(tokenReceiver.address, 1, signature.data)).to.be.rejectedWith("GS026");
        });

        it("Should transfer token with signature (sign: one signature, eth_sign)", async function () {
            const { owner1, tokenReceiver, executor, safe, module, erc20Contract } = await loadFixture(deployWalletWithModuleFixture);

            const hash = await module.connect(owner1).getTokenTransferApprovalHash(tokenReceiver.address, 10);
            const signature = await signHash(owner1, hash);

            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(10);
            await expect(await module.connect(executor).transferToken(tokenReceiver.address, 10, signature.data))
                .to.emit(module, "ApprovedTokenTransferred")
                .withArgs(tokenReceiver.address, 10);
            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(0);
            await expect(await erc20Contract.balanceOf(tokenReceiver.address)).to.be.eq(10);
        });

        it("Should transfer token with signature (sign typed data)", async function () {
            const { owner1, tokenReceiver, executor, safe, module, erc20Contract } = await loadFixture(deployWalletWithModuleFixture);

            const approval: TokenTransferApproval = {
                module: module.address,
                manager: safe.address,
                to: tokenReceiver.address,
                amount: 10,
                nonce: await module.nonce(),
            };
            const signature = await tokenTransferSignTypedData(owner1, module, approval);

            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(10);
            await expect(await module.connect(executor).transferToken(tokenReceiver.address, 10, signature.data))
                .to.emit(module, "ApprovedTokenTransferred")
                .withArgs(tokenReceiver.address, 10);
            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(0);
            await expect(await erc20Contract.balanceOf(tokenReceiver.address)).to.be.eq(10);
        });

        it("Should transfer token with signatures (two sigs, ecsign+typed data)", async function () {
            const { owner1, owner2, tokenReceiver, executor, safe, module, erc20Contract } =
                await loadFixture(deployWalletWithModuleFixture);
            await executeContractCallWithSigners(safe, safe, "addOwnerWithThreshold", [owner2.address, 2], [owner1]);
            await expect(await safe.isOwner(owner2.address)).to.be.true;

            const hash = await module.connect(owner1).getTokenTransferApprovalHash(tokenReceiver.address, 10);
            const signature1 = await signHash(owner1, hash);
            const approval: TokenTransferApproval = {
                module: module.address,
                manager: safe.address,
                to: tokenReceiver.address,
                amount: 10,
                nonce: await module.nonce(),
            };
            const signature2 = await tokenTransferSignTypedData(owner2, module, approval);

            const signatureBytes = buildSignatureBytes([signature1, signature2]);

            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(10);
            await expect(await module.connect(executor).transferToken(tokenReceiver.address, 10, signatureBytes))
                .to.emit(module, "ApprovedTokenTransferred")
                .withArgs(tokenReceiver.address, 10);
            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(0);
            await expect(await erc20Contract.balanceOf(tokenReceiver.address)).to.be.eq(10);
        });

        it("Should not transfer token with signature that was already used", async function () {
            const { owner1, tokenReceiver, executor, safe, module, erc20Contract } = await loadFixture(deployWalletWithModuleFixture);

            const hash = await module.connect(owner1).getTokenTransferApprovalHash(tokenReceiver.address, 1);
            const signature = await signHash(owner1, hash);

            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(10);
            await expect(await module.connect(executor).transferToken(tokenReceiver.address, 1, signature.data))
                .to.emit(module, "ApprovedTokenTransferred")
                .withArgs(tokenReceiver.address, 1);
            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(9);
            await expect(await erc20Contract.balanceOf(tokenReceiver.address)).to.be.eq(1);

            // Nonce mismatch
            await expect(module.connect(executor).transferToken(tokenReceiver.address, 1, signature.data)).to.be.rejectedWith("GS026");
            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(9);
            await expect(await erc20Contract.balanceOf(tokenReceiver.address)).to.be.eq(1);
        });

        it("Should fail if ERC20.transfer returned false", async function () {
            const { owner1, tokenReceiver, executor, safe, module, erc20Contract } = await loadFixture(deployWalletWithModuleFixture);

            const hash = await module.connect(owner1).getTokenTransferApprovalHash(tokenReceiver.address, 1);
            const signature = await signHash(owner1, hash);

            // transfer all tokens to receiver
            const data = erc20Contract.interface.encodeFunctionData("transfer", [tokenReceiver.address, 10]);
            await executeTxWithSigners(
                safe,
                buildSafeTransaction({ to: erc20Contract.address, data, safeTxGas: 10000, nonce: await safe.nonce() }),
                [owner1],
            );

            // transfer token with first signature (tokenReceiver, 1)
            // transfer failes because of insufficient balance
            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(0);
            await expect(await erc20Contract.balanceOf(tokenReceiver.address)).to.be.eq(10);
            await expect(module.connect(executor).transferToken(tokenReceiver.address, 1, signature.data)).revertedWithCustomError(
                module,
                "TokenTransferFailed",
            );
            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(0);
            await expect(await erc20Contract.balanceOf(tokenReceiver.address)).to.be.eq(10);
        });
    });

    describe("Module enabled/disabled", function () {
        it("Should fail if module is not initialized", async () => {
            const { owner1, tokenReceiver, safe, erc20Contract } = await loadFixture(deployWalletFixture);
            await erc20Contract.transfer(safe.address, 10);

            const module = await deployTokenTransferModule();

            await expect(module.connect(owner1).getTokenTransferApprovalHash(tokenReceiver.address, 10)).to.be.revertedWithCustomError(
                module,
                "ModuleNotInitialized",
            );

            await expect(module.connect(owner1).encodeTokenTransferApproval(tokenReceiver.address, 10)).to.be.revertedWithCustomError(
                module,
                "ModuleNotInitialized",
            );

            const approval: TokenTransferApproval = {
                module: module.address,
                manager: safe.address,
                to: tokenReceiver.address,
                amount: 10,
                nonce: await module.nonce(),
            };
            const signature = await tokenTransferSignTypedData(owner1, module, approval);
            await expect(module.connect(owner1).transferToken(tokenReceiver.address, 10, signature.data)).to.be.revertedWithCustomError(
                module,
                "ModuleNotInitialized",
            );
        });

        it("Should fail if module is not enabled", async () => {
            const { owner1, tokenReceiver, safe, erc20Contract } = await loadFixture(deployWalletFixture);
            await erc20Contract.transfer(safe.address, 10);

            const module = await deployTokenTransferModule();
            await executeContractCallWithSigners(safe, module, "setup", [erc20Contract.address], [owner1]);

            await expect(module.connect(owner1).getTokenTransferApprovalHash(tokenReceiver.address, 10)).to.be.revertedWithCustomError(
                module,
                "ModuleDisabled",
            );

            await expect(module.connect(owner1).encodeTokenTransferApproval(tokenReceiver.address, 10)).to.be.revertedWithCustomError(
                module,
                "ModuleDisabled",
            );

            const approval: TokenTransferApproval = {
                module: module.address,
                manager: safe.address,
                to: tokenReceiver.address,
                amount: 10,
                nonce: await module.nonce(),
            };
            const signature = await tokenTransferSignTypedData(owner1, module, approval);
            await expect(module.connect(owner1).transferToken(tokenReceiver.address, 10, signature.data)).to.be.revertedWithCustomError(
                module,
                "ModuleDisabled",
            );
        });
    });

    describe("Signature types", function () {
        it("Should sign for responding challenge transaction ( eth_sign )", async () => {
            // tested through items above
        });

        it("Should sign for transfer approval hash (1 sig, contract signature)", async () => {
            const { owner1, signerSafeOwner, tokenReceiver, executor, signerSafe, module, messageHandler } = await loadFixture(
                deployWalletWithModuleForContracgSignatureFixture,
            );

            const hash = await module.connect(owner1).encodeTokenTransferApproval(tokenReceiver.address, 10);
            const messageHash = await messageHandler.getMessageHash(hash);
            const signerSafeOwnerSig = await buildSignatureBytes([await signHash(signerSafeOwner, messageHash)]);
            const encodedSignerOwnerSign = defaultAbiCoder.encode(["bytes"], [signerSafeOwnerSig]).slice(66);

            const signature =
                "0x" +
                "000000000000000000000000" +
                signerSafe.address.slice(2) +
                "0000000000000000000000000000000000000000000000000000000000000041" +
                "00" + // r, s, v
                encodedSignerOwnerSign; // attached signature by signerSafe's owner

            await expect(await module.connect(executor).transferToken(tokenReceiver.address, 10, signature))
                .to.emit(module, "ApprovedTokenTransferred")
                .withArgs(tokenReceiver.address, 10);
        });

        it("Should sign for transfer approval hash(approve hash)", async () => {
            const { owner1, tokenReceiver, executor, safe, module, erc20Contract } = await loadFixture(deployWalletWithModuleFixture);

            const hash = ethers.utils.arrayify(await module.connect(owner1).getTokenTransferApprovalHash(tokenReceiver.address, 10));

            await expect(await safe.connect(owner1).approveHash(hash))
                .to.emit(safe, "ApproveHash")
                .withArgs(hash, owner1.address);
            const signatures = [
                {
                    signer: owner1.address,
                    data:
                        "0x000000000000000000000000" +
                        owner1.address.slice(2) +
                        "0000000000000000000000000000000000000000000000000000000000000000" +
                        "01",
                },
            ];

            const signatureBytes = buildSignatureBytes(signatures).toLowerCase();

            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(10);
            await expect(await module.connect(executor).transferToken(tokenReceiver.address, 10, signatureBytes))
                .to.emit(module, "ApprovedTokenTransferred")
                .withArgs(tokenReceiver.address, 10);
            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(0);
            await expect(await erc20Contract.balanceOf(tokenReceiver.address)).to.be.eq(10);
        });

        it("Should sign for transfer approval hash (ecsign)", async () => {
            const { owner1, tokenReceiver, executor, safe, module, erc20Contract } = await loadFixture(deployWalletWithModuleFixture);

            // const hash = ethers.utils.arrayify(await module.connect(owner1).getTokenTransferApprovalHash(tokenReceiver.address, 10));
            const hash = await module.connect(owner1).getTokenTransferApprovalHash(tokenReceiver.address, 10);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const hardhatAcc = config.networks.hardhat.accounts as any;
            const index = 0;
            const wallet = ethers.Wallet.fromMnemonic(hardhatAcc.mnemonic, hardhatAcc.path + `/${index}`);

            const signatureData = ecsign(toBuffer(hash), toBuffer(wallet.privateKey));
            const signature = "0x" + signatureData.r.toString("hex") + signatureData.s.toString("hex") + signatureData.v.toString(16);

            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(10);
            await expect(await module.connect(executor).transferToken(tokenReceiver.address, 10, signature))
                .to.emit(module, "ApprovedTokenTransferred")
                .withArgs(tokenReceiver.address, 10);
            await expect(await erc20Contract.balanceOf(safe.address)).to.be.eq(0);
            await expect(await erc20Contract.balanceOf(tokenReceiver.address)).to.be.eq(10);
        });
    });
});
