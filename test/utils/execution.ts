import { SafeTransaction, safeSignTypedData, executeTx, buildContractCall } from "@gnosis.pm/safe-contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { TypedDataSigner } from "@ethersproject/abstract-signer";
import hre from "hardhat";
import { Contract, BigNumber, BigNumberish, Signer } from "ethers";

export const EIP_DOMAIN = {
    EIP712Domain: [
        { type: "uint256", name: "chainId" },
        { type: "address", name: "verifyingContract" },
    ],
};

export const EIP712_TOKEN_TRANSFER_MODULE_TYPE = {
    // "TokenTransferModuleApproval(address module,address manager,address to,uint256 amount,uint256 nonce)"
    TokenTransferModuleApproval: [
        { type: "address", name: "module" },
        { type: "address", name: "manager" },
        { type: "address", name: "to" },
        { type: "uint256", name: "amount" },
        { type: "uint256", name: "nonce" },
    ],
};

export interface TokenTransferApproval {
    module: string;
    manager: string;
    to: string;
    amount: number | string;
    nonce: number | string;
}

export const getErrorMessage = async (to: string, value: BigNumber, data: string, from: string) => {
    const rawcall = await hre.network.provider.send("eth_call", [
        {
            from: from,
            to: to,
            //    value: value.toHexString(),
            data: data,
        },
    ]);
    const returnBuffer = Buffer.from(rawcall.slice(8), "hex");
    return new TextDecoder().decode(returnBuffer);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const executeTxWithSigners = async (safe: Contract, tx: SafeTransaction, signers: SignerWithAddress[], overrides?: any) => {
    const sigs = await Promise.all(signers.map((signer) => safeSignTypedData(signer, safe, tx)));
    return executeTx(safe, tx, sigs, overrides);
};

export const executeContractCallWithSigners = async (
    safe: Contract,
    contract: Contract,
    method: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: any[],
    signers: SignerWithAddress[],
    delegateCall?: boolean,
    overrides?: Partial<SafeTransaction>,
) => {
    const tx = buildContractCall(contract, method, params, await safe.nonce(), delegateCall, overrides);
    return executeTxWithSigners(safe, tx, signers);
};

export const tokenTransferSignTypedData = async (
    signer: Signer & TypedDataSigner,
    module: Contract,
    approval: TokenTransferApproval,
    chainId?: BigNumberish,
): Promise<{ signer: string; data: string }> => {
    if (!chainId && !signer.provider) throw Error("Provider required to retrieve chainId");
    const cid = chainId || (await signer.provider!.getNetwork()).chainId;
    const signerAddress = await signer.getAddress();
    return {
        signer: signerAddress,
        data: await signer._signTypedData({ verifyingContract: module.address, chainId: cid }, EIP712_TOKEN_TRANSFER_MODULE_TYPE, approval),
    };
};
