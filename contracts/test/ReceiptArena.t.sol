// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {EvidenceRegistry} from "../src/EvidenceRegistry.sol";
import {ReceiptArena} from "../src/ReceiptArena.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

interface Vm {
    function etch(address target, bytes calldata code) external;
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
}

/// @dev 단위 테스트 전용. 실제 증명 성공의 근거가 아니다.
contract MockVerifier {
    mapping(uint64 => bytes32) private allowed;
    function authorize(uint64 height, bytes32 dataHash) external { allowed[height] = dataHash; }
    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata) external pure returns (uint64) { return 0; }
    function verify(uint64 chainKey, uint64 height, bytes calldata encoded,
        INativeQueryVerifier.MerkleProof calldata, INativeQueryVerifier.ContinuityProof calldata)
        external view returns (bool)
    {
        return chainKey == 1 && allowed[height] == keccak256(encoded);
    }
}

contract ReceiptArenaTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant GENUINE = address(0x1111);
    address private constant FORGED = address(0x2222);
    address private constant RECIPIENT = address(0x3333);
    bytes32 private constant CASE_KEY = keccak256("arena-fixture");
    EvidenceRegistry private registry;
    ReceiptArena private arena;
    MockVerifier private verifier;
    bytes32 private normalId;
    bytes32 private forgedId;
    bytes32 private mixedId;

    function setUp() public {
        MockVerifier implementation = new MockVerifier();
        vm.etch(address(0xFD2), address(implementation).code);
        verifier = MockVerifier(address(0xFD2));
        registry = new EvidenceRegistry();
        arena = new ReceiptArena(registry);
        normalId = _register(100, _encoded(GENUINE, false, 1));
        forgedId = _register(101, _encoded(FORGED, false, 1));
        mixedId = _register(102, _encoded(FORGED, true, 1));
        arena.configureLevel(1, _level(normalId, forgedId));
        arena.configureLevel(2, _level(normalId, normalId));
        arena.configureLevel(3, _level(mixedId, forgedId));
    }

    function testEmitterGuardKeepsNormalPayment() public view {
        ReceiptArena.Outcome memory vulnerable = arena.preview(1, 0);
        require(vulnerable.normalPaid == 50 && vulnerable.attackPaid == 50 && !vulnerable.cleared);
        ReceiptArena.Outcome memory defended = arena.preview(1, 1);
        require(defended.normalPaid == 50 && defended.attackPaid == 0 && defended.cleared);
    }

    function testReplayIsScopedToEachPreview() public view {
        require(arena.preview(2, 0).attackPaid == 50);
        require(arena.preview(2, 2).cleared);
        require(arena.preview(2, 2).normalPaid == 50);
        require(arena.preview(2, 2).cleared);
    }

    function testDecoyRequiresScanningAndEmitterCheck() public view {
        require(arena.preview(3, 1).normalPaid == 0);
        require(!arena.preview(3, 1).cleared);
        require(arena.preview(3, 4).attackPaid == 50);
        require(arena.preview(3, 5).cleared);
    }

    function testCompletionIsRecomputedAndIsolated() public {
        vm.expectRevert(ReceiptArena.NotCleared.selector);
        arena.complete(1, 0);
        vm.prank(address(0xAA));
        arena.complete(1, 1);
        require(arena.completed(address(0xAA), 1));
        require(!arena.completed(address(0xBB), 1));
        vm.prank(address(0xAA));
        arena.complete(1, 1);
        vm.prank(address(0xBB));
        arena.complete(1, 1);
        require(arena.completed(address(0xBB), 1));
    }

    function testInvalidRulesAndLevelRejected() public {
        vm.expectRevert(ReceiptArena.InvalidRules.selector);
        arena.preview(1, 8);
        vm.expectRevert(ReceiptArena.InvalidLevel.selector);
        arena.preview(0, 0);
    }

    function testUnauthorizedAndMutableLevelRejected() public {
        ReceiptArena.Level memory level = _level(normalId, forgedId);
        vm.prank(address(0xBAD));
        vm.expectRevert(ReceiptArena.Unauthorized.selector);
        arena.configureLevel(1, level);
        vm.expectRevert(ReceiptArena.InvalidLevel.selector);
        arena.configureLevel(1, level);
    }

    function testTamperedUnverifiedReceiptRejected() public {
        bytes memory encoded = _encoded(GENUINE, false, 1);
        vm.expectRevert(EvidenceRegistry.InvalidProof.selector);
        registry.register(999, encoded, _merkle(), _continuity());
    }

    function testDuplicateRegistrationRejected() public {
        vm.expectRevert(EvidenceRegistry.AlreadyRegistered.selector);
        registry.register(100, _encoded(GENUINE, false, 1), _merkle(), _continuity());
    }

    function testRevertedTransactionRejectedEvenWithAcceptedProof() public {
        bytes memory encoded = _encoded(GENUINE, false, 0);
        verifier.authorize(500, keccak256(encoded));
        vm.expectRevert(EvidenceRegistry.InvalidReceipt.selector);
        registry.register(500, encoded, _merkle(), _continuity());
    }

    function testMissingEvidenceRejected() public {
        vm.expectRevert(EvidenceRegistry.MissingEvidence.selector);
        registry.getEvidence(bytes32(uint256(999)));
    }

    function testFuzzRulesDoNotClearUnsafePaths(uint8 rules) public view {
        rules = rules % 8;
        require(arena.preview(1, rules).cleared == ((rules & 1) != 0));
        require(arena.preview(2, rules).cleared == ((rules & 2) != 0));
        require(arena.preview(3, rules).cleared == ((rules & 5) == 5));
    }

    function _level(bytes32 normal, bytes32 attack) private pure returns (ReceiptArena.Level memory) {
        return ReceiptArena.Level(true, GENUINE, RECIPIENT, CASE_KEY, normal, attack);
    }

    function _register(uint64 height, bytes memory encoded) private returns (bytes32) {
        verifier.authorize(height, keccak256(encoded));
        return registry.register(height, encoded, _merkle(), _continuity());
    }

    function _encoded(address emitter, bool mixed, uint8 status) private pure returns (bytes memory) {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](mixed ? 2 : 1);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = keccak256("PaymentRecorded(bytes32,address,uint256)");
        topics[1] = CASE_KEY;
        topics[2] = bytes32(uint256(uint160(RECIPIENT)));
        logs[0] = EvmV1Decoder.LogEntryTuple(emitter, topics, abi.encode(uint256(50)));
        if (mixed) logs[1] = EvmV1Decoder.LogEntryTuple(GENUINE, topics, abi.encode(uint256(50)));
        bytes[] memory chunks = new bytes[](3);
        chunks[2] = abi.encode(status, uint64(21000), logs, bytes(""));
        return abi.encode(uint8(2), chunks);
    }

    function _merkle() private pure returns (INativeQueryVerifier.MerkleProof memory) {
        return INativeQueryVerifier.MerkleProof(bytes32(0), new INativeQueryVerifier.MerkleProofEntry[](0));
    }

    function _continuity() private pure returns (INativeQueryVerifier.ContinuityProof memory) {
        return INativeQueryVerifier.ContinuityProof(bytes32(0), new bytes32[](0));
    }
}
