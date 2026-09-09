// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice 퍼즐 증거를 만드는 테스트 전용 계약. 실제 결제나 자산 이동이 아니다.
contract ScenarioSource {
    event PaymentRecorded(bytes32 indexed caseKey, address indexed recipient, uint256 amount);

    function record(bytes32 caseKey, address recipient, uint256 amount) external {
        emit PaymentRecorded(caseKey, recipient, amount);
    }
}

contract ScenarioRouter {
    function mixed(ScenarioSource decoy, ScenarioSource genuine, bytes32 caseKey, address recipient, uint256 amount)
        external
    {
        decoy.record(caseKey, recipient, amount);
        genuine.record(caseKey, recipient, amount);
    }
}
