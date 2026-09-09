// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @notice 실제 Sepolia 영수증을 검증·보존한다. 지급 허용 여부는 게임이 판단한다.
contract EvidenceRegistry {
    INativeQueryVerifier public constant VERIFIER = INativeQueryVerifier(address(0xFD2));
    uint64 public constant SOURCE_CHAIN_KEY = 1;
    bytes32 public constant PAYMENT_TOPIC = keccak256("PaymentRecorded(bytes32,address,uint256)");
    uint256 public constant MAX_LOGS = 16;

    struct PaymentLog {
        address emitter;
        bytes32 caseKey;
        address recipient;
        uint256 amount;
    }

    struct Evidence {
        bool exists;
        uint64 blockHeight;
        uint64 transactionIndex;
        bytes32 transactionDataHash;
        PaymentLog[] logs;
    }

    mapping(bytes32 => Evidence) private evidence;

    error InvalidProof();
    error AlreadyRegistered();
    error InvalidReceipt();
    error MissingEvidence();
    event EvidenceRegistered(bytes32 indexed id, uint64 blockHeight, uint64 transactionIndex, bytes32 dataHash);

    function register(
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata continuityProof
    ) external returns (bytes32 id) {
        uint64 txIndex = VERIFIER.calculateTxIndex(merkleProof);
        id = keccak256(abi.encode(SOURCE_CHAIN_KEY, blockHeight, txIndex));
        if (evidence[id].exists) revert AlreadyRegistered();
        if (!VERIFIER.verify(SOURCE_CHAIN_KEY, blockHeight, encodedTransaction, merkleProof, continuityProof)) {
            revert InvalidProof();
        }

        if (!EvmV1Decoder.isValidTransactionType(EvmV1Decoder.getTransactionType(encodedTransaction))) {
            revert InvalidReceipt();
        }
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert InvalidReceipt();
        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, PAYMENT_TOPIC);
        if (logs.length == 0 || logs.length > MAX_LOGS) revert InvalidReceipt();

        Evidence storage item = evidence[id];
        item.exists = true;
        item.blockHeight = blockHeight;
        item.transactionIndex = txIndex;
        item.transactionDataHash = keccak256(encodedTransaction);
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length != 3 || logs[i].data.length != 32) revert InvalidReceipt();
            uint256 amount = abi.decode(logs[i].data, (uint256));
            if (amount == 0 || amount > 1_000_000) revert InvalidReceipt();
            item.logs.push(PaymentLog({
                emitter: logs[i].address_,
                caseKey: logs[i].topics[1],
                recipient: address(uint160(uint256(logs[i].topics[2]))),
                amount: amount
            }));
        }
        emit EvidenceRegistered(id, blockHeight, txIndex, item.transactionDataHash);
    }

    function getEvidence(bytes32 id) external view returns (Evidence memory) {
        if (!evidence[id].exists) revert MissingEvidence();
        return evidence[id];
    }
}
