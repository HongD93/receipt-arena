import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { AbiCoder, Contract, Interface, JsonRpcProvider, keccak256 } from 'ethers';

// 공개 RPC와 공개 배포 정보만 사용한다. 키·환경 파일을 읽거나 거래를 전송하지 않는다.
const deployment = JSON.parse(readFileSync('public/deployment.json', 'utf8'));
const abis = JSON.parse(readFileSync('public/contracts.json', 'utf8'));
const target = new JsonRpcProvider(deployment.targetRpc);
const source = new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
const registry = new Contract(deployment.registry, abis.registry, target);
const arena = new Contract(deployment.arena, abis.arena, target);
const registryInterface = new Interface(abis.registry);
const results = [];
async function requireTransaction(read) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Public RPC did not return the transaction after three attempts');
}
try {
  assert.equal((await target.getNetwork()).chainId, 102031n);
  assert.equal((await source.getNetwork()).chainId, 11155111n);
  assert.equal((await arena.registry()).toLowerCase(), deployment.registry.toLowerCase());
  assert.equal((await registry.VERIFIER()).toLowerCase(), '0x0000000000000000000000000000000000000fd2');
  for (const [name, meta] of Object.entries(deployment.evidence)) {
    const [sourceReceipt, registration, registrationTx, entry] = await Promise.all([
      requireTransaction(() => source.getTransactionReceipt(meta.sourceTransaction)),
      requireTransaction(() => target.getTransactionReceipt(meta.registrationTransaction)),
      requireTransaction(() => target.getTransaction(meta.registrationTransaction)),
      registry.getEvidence(meta.id),
    ]);
    assert.equal(sourceReceipt.status, 1);
    assert.equal(registration.status, 1);
    assert.equal(registrationTx.to.toLowerCase(), deployment.registry.toLowerCase());
    assert.equal(sourceReceipt.blockNumber, meta.sourceBlock);
    assert.equal(entry.blockHeight, BigInt(meta.sourceBlock));
    assert.equal(entry.transactionIndex, BigInt(sourceReceipt.index));
    assert.equal(
      meta.id,
      keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ['uint64', 'uint64', 'uint64'],
          [1, meta.sourceBlock, sourceReceipt.index],
        ),
      ),
    );
    const call = registryInterface.parseTransaction({ data: registrationTx.data });
    assert.equal(call.name, 'register');
    assert.equal(keccak256(call.args.encodedTransaction), entry.transactionDataHash);
    assert.equal(entry.exists, true);
    results.push({ evidence: name, sourceStatus: 1, registrationStatus: 1, logs: entry.logs.length });
  }
  for (const level of deployment.availableLevels) {
    for (let mask = 0; mask < 8; mask++) {
      const result = await arena.preview(level, mask);
      const expectedNormal = level === 3 && mask & 1 && !(mask & 4) ? 0 : 50;
      const expectedAttack = level === 2 ? (mask & 2 ? 0 : 50) : mask & 1 ? 0 : 50;
      assert.equal(result.normalPaid, BigInt(expectedNormal));
      assert.equal(result.attackPaid, BigInt(expectedAttack));
      assert.equal(result.expectedNormal, 50n);
      assert.equal(result.cleared, expectedNormal === 50 && expectedAttack === 0);
      results.push({
        level,
        mask,
        normalPaid: expectedNormal,
        attackPaid: expectedAttack,
        cleared: result.cleared,
      });
    }
    const meta = deployment.checks[`level${level}`];
    const completion = await target.getTransactionReceipt(meta.completionTransaction);
    assert.equal(completion.status, 1);
    assert.equal(completion.to.toLowerCase(), deployment.arena.toLowerCase());
    assert.equal(await arena.completed(deployment.recipient, level), true);
  }
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(
    'docs/evidence/testnet-verification.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        sourceChainId: 11155111,
        targetChainId: 102031,
        arena: deployment.arena,
        registry: deployment.registry,
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${Object.keys(deployment.evidence).length} source/registration pairs; ${deployment.availableLevels.length * 8} rule combinations; persisted completions.`,
  );
} catch (error) {
  console.error('Verification failed:', error.code ?? error.name);
  console.error(
    error.stack
      ?.split('\n')
      .filter((line) => line.includes('verify-testnet.mjs'))
      .join('\n'),
  );
  process.exitCode = 1;
} finally {
  source.destroy();
  target.destroy();
}
