// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {EvidenceRegistry} from "./EvidenceRegistry.sol";

/// @notice 검증된 증거로 가상 지급을 판정한다. 자산 전송·예금 기능은 없다.
contract ReceiptArena {
    uint8 public constant CHECK_EMITTER = 1;
    uint8 public constant PREVENT_REPLAY = 2;
    uint8 public constant SCAN_LOGS = 4;

    struct Level {
        bool exists;
        address expectedEmitter;
        address recipient;
        bytes32 caseKey;
        bytes32 normalEvidence;
        bytes32 attackEvidence;
    }

    struct Outcome {
        uint256 normalPaid;
        uint256 attackPaid;
        uint256 expectedNormal;
        bool cleared;
    }

    EvidenceRegistry public immutable registry;
    address public immutable curator;
    mapping(uint8 => Level) public levels;
    mapping(address => mapping(uint8 => bool)) public completed;

    error Unauthorized();
    error InvalidLevel();
    error InvalidRules();
    error NotCleared();
    event LevelConfigured(uint8 indexed level, bytes32 normalEvidence, bytes32 attackEvidence);
    event LevelCleared(address indexed player, uint8 indexed level, uint8 rules);

    constructor(EvidenceRegistry evidenceRegistry) {
        registry = evidenceRegistry;
        curator = msg.sender;
    }

    function configureLevel(uint8 number, Level calldata level) external {
        if (msg.sender != curator) revert Unauthorized();
        if (number < 1 || number > 3 || levels[number].exists || !level.exists || level.expectedEmitter == address(0)) {
            revert InvalidLevel();
        }
        EvidenceRegistry.Evidence memory normal = registry.getEvidence(level.normalEvidence);
        EvidenceRegistry.Evidence memory attack = registry.getEvidence(level.attackEvidence);
        if (_payment(normal.logs, level, CHECK_EMITTER | SCAN_LOGS) == 0) revert InvalidLevel();
        if (number == 2 && level.normalEvidence != level.attackEvidence) revert InvalidLevel();
        if (number != 2 && _payment(attack.logs, level, CHECK_EMITTER | SCAN_LOGS) != 0) revert InvalidLevel();
        levels[number] = level;
        emit LevelConfigured(number, level.normalEvidence, level.attackEvidence);
    }

    function preview(uint8 number, uint8 rules) public view returns (Outcome memory result) {
        if (rules > 7) revert InvalidRules();
        Level memory level = levels[number];
        if (!level.exists) revert InvalidLevel();
        EvidenceRegistry.Evidence memory normal = registry.getEvidence(level.normalEvidence);
        EvidenceRegistry.Evidence memory attack = registry.getEvidence(level.attackEvidence);
        result.expectedNormal = _payment(normal.logs, level, CHECK_EMITTER | SCAN_LOGS);
        result.normalPaid = _payment(normal.logs, level, rules);
        bool replayBlocked = level.normalEvidence == level.attackEvidence && (rules & PREVENT_REPLAY) != 0;
        result.attackPaid = replayBlocked ? 0 : _payment(attack.logs, level, rules);
        result.cleared = result.normalPaid == result.expectedNormal && result.attackPaid == 0;
    }

    function complete(uint8 number, uint8 rules) external {
        if (!preview(number, rules).cleared) revert NotCleared();
        if (!completed[msg.sender][number]) {
            completed[msg.sender][number] = true;
            emit LevelCleared(msg.sender, number, rules);
        }
    }

    function _payment(EvidenceRegistry.PaymentLog[] memory logs, Level memory level, uint8 rules)
        private pure returns (uint256)
    {
        uint256 limit = (rules & SCAN_LOGS) != 0 ? logs.length : 1;
        for (uint256 i; i < limit; ++i) {
            EvidenceRegistry.PaymentLog memory entry = logs[i];
            if (entry.caseKey != level.caseKey || entry.recipient != level.recipient) continue;
            if ((rules & CHECK_EMITTER) != 0 && entry.emitter != level.expectedEmitter) continue;
            return entry.amount;
        }
        return 0;
    }
}
