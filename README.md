# module-test
home task for a module development of safe contract

# Setup an test
Setup environment:
```
$ yarn install && yarn run compile
```
Check test coverage for contracts:
```
$ yarn run coverage
```

# TokenTransferModule
This module has the features below:
- Gnosis Safe's owner can pre-approve token transfer
- Anyone who has the signature can send the pre-approved token transfer
- Deployable through SafeProxyFactory
- Supports all signature types GnosisSafe accepts
- Supports multiple signatures (optional feature implementation)
(The optional feature that invalidate signature after set period is not implemented in this version)

#### Flow of token transfer using TokenTransferModule
Alice wants to send tokens to Bob from her wallet. She pre-approves the token transfer by signing, and send the signature with amount to Bob. Bob then interacts TokenTransferModule contract to send transaction with given signature on behalf of Alice. Bob will pay for the transaction fee.

```mermaid
sequenceDiagram
    participant Alice
    participant Relay as Bob
    participant Module
    participant Safe
    participant ERC20Token

    Alice->>Module: getTokenTransferApprovalHash(Bob's address, amount)
    Module->>Module: encode inputs data and hash
    Module-->>Alice: return token transfer approval hash
    Alice->>Alice: sign hash
    Alice->>Relay: send signature with transferring amount
    Relay->>Module: transfer token with defined "Bob's address", "amount" and signature
    Module->>Module: check if hash is signed by owners
    Module->>Safe: call execTransactionFromModule
    Safe->>ERC20Token: transfer token to Bob's address

```
