// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.21;
import {SignatureDecoder} from "@gnosis.pm/safe-contracts/contracts/common/SignatureDecoder.sol";
import {Singleton} from "@gnosis.pm/safe-contracts/contracts/common/Singleton.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";

/// Interface definition for GnosisSafe
/// @notice these 3 contract interfaces are defined here to avoid importing whole contract codes.
// solhint-disable-next-line one-contract-per-file
interface GnosisSafe {
    function checkSignatures(bytes32 dataHash, bytes memory data, bytes memory signatures) external view;
}

// solhint-disable-next-line one-contract-per-file
interface ModuleManager {
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

/// @title TokenTransferModule
/// @author ai suzuki
///
/// @notice This module allows safe contract to transfer ERC20 tokens by owner's approval.
///         The module can be deployed through SafeProxyFactory to save gas for deployal and upgradable
contract TokenTransferModule is Singleton, SignatureDecoder {
    /// EIP-712 typehash declaration for TokenTransferModuleApproval
    bytes32 private constant DOMAIN_SEPARATOR_TYPEHASH = keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");
    bytes32 private constant TOKENTRANSFER_MODULE_APPROVAL_TYPEHASH =
        keccak256("TokenTransferModuleApproval(address module,address manager,address to,uint256 amount,uint256 nonce)");

    string public constant NAME = "TokenTransferModule";
    string public constant VERSION = "1.0.0";

    /// Safe contract address that activates this module
    address private manager;

    /// ERC20 token contract address
    address public token;

    /// Nonce for token transfer approval. This is used to prevent replay attack.
    uint256 public nonce;

    /// ---- events ----
    event ApprovedTokenTransferred(address to, uint256 amount);

    /// ---- erros ----
    error ModuleAlreadyInitialized();
    error ModuleNotInitialized();
    error InvalidAddress();
    error InsufficientBalance(uint256 balance);
    error OnlyOwner();
    error ModuleDisabled();
    error TokenTransferFailed();

    /// ---- modifiers ----
    modifier ownerOnly() {
        isOwner(msg.sender);
        _;
    }

    modifier moduleEnabled() {
        isModuleEnabled();
        _;
    }

    /// @dev this module must be initialized by setup function below
    constructor() {}

    /// Function to initialize this module
    ///
    /// @param tokenContract ERC20 token contract address
    function setup(address tokenContract) public {
        if (manager != address(0x0)) revert ModuleAlreadyInitialized();
        if (tokenContract == address(0x0) || tokenContract == address(0x1)) revert InvalidAddress();

        /// @dev tokenContract address should also be checked if it is ERC20 token contract here
        /// since ERC20 token contract does not support ERC165, I'll omit it
        /// possible solution is to set supported token list in the module and check if
        /// token contract's name matches with the list.

        manager = msg.sender; // Safe contract address
        token = tokenContract;
    }

    /// Transfer ERC20 token to the given "to" address
    ///
    /// @param to token receiver address
    /// @param amount amount of token to transfer
    /// @param signatures signatures by owners for token transfer approval
    function transferToken(address to, uint256 amount, bytes memory signatures) public moduleEnabled {
        bytes memory encodedData = encodeTokenTransferApproval(to, amount);
        bytes32 dataHash = keccak256(encodedData);

        GnosisSafe(payable(manager)).checkSignatures(dataHash, encodedData, signatures);
        nonce++;

        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", to, amount);
        if (!ModuleManager(manager).execTransactionFromModule(token, 0, data, Enum.Operation.Call)) revert TokenTransferFailed();

        emit ApprovedTokenTransferred(to, amount);
    }

    /// Generate token transfer approval hash to be signed by owners
    ///
    /// @param to token receiver address
    /// @param amount amount of token to transfer
    /// @return approvalHash hash of token transfer approval to be signed by owners
    function getTokenTransferApprovalHash(address to, uint256 amount) public view moduleEnabled ownerOnly returns (bytes32 approvalHash) {
        if (to == address(0x0) || to == address(0x1)) revert InvalidAddress();
        uint256 balance = IERC20(token).balanceOf(manager);
        if (balance < amount) revert InsufficientBalance(balance);

        return keccak256(encodeTokenTransferApproval(to, amount));
    }

    /// Generate encoded token transfer approval data
    /// @dev this function is used for ERC-1271 sigining(https://eips.ethereum.org/EIPS/eip-1271).
    ///      see example code test/TokenTransferModule.spec.ts:381 for more details.
    ///
    /// @param to token receiver address
    /// @param amount amount of token to transfer
    /// @return encodedApprovalData encoded token transfer approval data 
    function encodeTokenTransferApproval(address to, uint256 amount) public view returns (bytes memory encodedApprovalData) {
        uint256 chainId = block.chainid;
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, chainId, address(this)));
        bytes32 transactionHash = keccak256(abi.encode(TOKENTRANSFER_MODULE_APPROVAL_TYPEHASH, address(this), manager, to, amount, nonce));
        return abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator, transactionHash);
    }

    /// Check if the given address is owner of the safe contract
    ///
    /// @param verifyingAddress address to verify if it is owner
    function isOwner(address verifyingAddress) private view {
        if (!OwnerManager(manager).isOwner(verifyingAddress)) revert OnlyOwner();
    }

    /// Check if this module is initialized and enabled by the safe contract
    function isModuleEnabled() private view {
        if (manager == address(0x0)) revert ModuleNotInitialized();
        if (!ModuleManager(manager).isModuleEnabled(address(this))) revert ModuleDisabled();
    }
}
