// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.21;
import {SignatureDecoder} from "@gnosis.pm/safe-contracts/contracts/common/SignatureDecoder.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";

// import {console} from "hardhat/console.sol";

// solhint-disable-next-line one-contract-per-file
interface GnosisSafe {
    function checkSignatures(bytes32 dataHash, bytes memory data, bytes memory signatures) external view;
}

// solhint-disable-next-line one-contract-per-file
interface  ModuleManager {
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) external returns (bool success);

    function isModuleEnabled(address module) external view returns (bool);
}

// solhint-disable-next-line one-contract-per-file
interface OwnerManager {
    function isOwner(address owner) external view returns (bool);
}

contract TokenTransferModule is SignatureDecoder {
    bytes32 public constant DOMAIN_SEPARATOR_TYPEHASH = keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");

    bytes32 public constant TOKENTRANSFER_MODULE_APPROVAL_TYPEHASH =
        keccak256("TokenTransferModuleApproval(address module,address manager,address to,uint256 amount,uint256 nonce)");

    address internal manager;
    address public token;

    uint256 public nonce;

    event ApprovedTokenTransferred(address to, uint256 amount);

    error ModuleAlreadyInitialized();
    error ModuleNotInitialized();
    error InvalidAddress();
    error InsufficientBalance(uint256 balance);
    error OnlyOwner();
    error ModuleDisabled();
    error TokenAlreadyTransferred();
    error TokenTransferFailed();

    modifier ownerOnly() {
        isOwner(msg.sender);
        _;
    }

    modifier moduleEnabled() {
        isModuleEnabled();
        _;
    }

    constructor() {}

    function setup(address tokenContract) public {
        if (manager != address(0x0)) revert ModuleAlreadyInitialized();
        if (tokenContract == address(0x0) || tokenContract == address(0x1)) revert InvalidAddress();

        // tokenContract address should also be checked if it is ERC20 token contract here
        // since ERC20 token contract does not support ERC165, I'll omit it
        // possible solution is to set supported token list in the module and check if
        // token contract's name matches with the list.

        manager = msg.sender; // Safe contract address
        token = tokenContract;
    }

    function transferToken(address to, uint256 amount, bytes memory signatures) public moduleEnabled {
        bytes memory encodedData = encodeTokenTransferApproval(to, amount);
        bytes32 dataHash = keccak256(encodedData);

        GnosisSafe(payable(manager)).checkSignatures(dataHash, encodedData, signatures);
        nonce++;

        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", to, amount);
        if (!ModuleManager(manager).execTransactionFromModule(token, 0, data, Enum.Operation.Call)) revert TokenTransferFailed();

        emit ApprovedTokenTransferred(to, amount);
    }

    function getTokenTransferApprovalHash(address to, uint256 amount) public view moduleEnabled ownerOnly returns (bytes32 approvalHash) {
        if (to == address(0x0) || to == address(0x1)) revert InvalidAddress();
        uint256 balance = IERC20(token).balanceOf(manager);
        if (balance < amount) revert InsufficientBalance(balance);

        return keccak256(encodeTokenTransferApproval(to, amount));
    }

    function encodeTokenTransferApproval(address to, uint256 amount) private view returns (bytes memory) {
        uint256 chainId = block.chainid;
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, chainId, address(this)));
        bytes32 transactionHash = keccak256(abi.encode(TOKENTRANSFER_MODULE_APPROVAL_TYPEHASH, address(this), manager, to, amount, nonce));
        return abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator, transactionHash);
    }

    function isOwner(address verifyingAddress) private view {
        if (!OwnerManager(manager).isOwner(verifyingAddress)) revert OnlyOwner();
    }

    function isModuleEnabled() private view {
        if (manager == address(0x0)) revert ModuleNotInitialized();
        if (!ModuleManager(manager).isModuleEnabled(address(this))) revert ModuleDisabled();
    }
}
