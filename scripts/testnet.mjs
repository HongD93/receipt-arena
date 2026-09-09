import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  keccak256,
  toUtf8Bytes,
  AbiCoder,
} from 'ethers';
import { proofProvider } from '@gluwa/usc-sdk';

const command = process.argv[2] ?? 'inspect';
if (!['inspect', 'level1', 'extend'].includes(command)) throw new Error('Unknown command');
const envPath = resolve(
  process.env.ARENA_ENV_FILE ?? '../buidl-ctc-project/attestcoin-protocol-examples/bridge/.env',
);
const secrets = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
const value = (key) => process.env[key] ?? secrets[key];
const cc = new JsonRpcProvider(
  value('CREDITCOIN_RPC_URL') ?? 'https://rpc.cc3-testnet.creditcoin.network',
  undefined,
  { cacheTimeout: -1 },
);
const sepolia = new JsonRpcProvider(
  value('SOURCE_CHAIN_RPC_URL') ?? 'https://ethereum-sepolia-rpc.publicnode.com',
  undefined,
  { cacheTimeout: -1 },
);
const artifact = (name) => JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, 'utf8'));
const sourceArtifact = artifact('ScenarioSource');
const routerArtifact = JSON.parse(readFileSync('out/ScenarioSource.sol/ScenarioRouter.json', 'utf8'));
const registryArtifact = artifact('EvidenceRegistry');
const arenaArtifact = artifact('ReceiptArena');
const statePath = '.local/deployment-state.json';
mkdirSync('.local', { recursive: true });
mkdirSync('public', { recursive: true });
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, 'utf8'))
  : { transactions: {}, evidence: {}, checks: {} };
const save = () => {
  writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${statePath}.tmp`, statePath);
};
const log = (stage, detail = '') => console.log(`${new Date().toISOString()} ${stage} ${detail}`);

async function main() {
  const [sourceNetwork, targetNetwork] = await Promise.all([sepolia.getNetwork(), cc.getNetwork()]);
  if (sourceNetwork.chainId !== 11155111n || targetNetwork.chainId !== 102031n)
    throw new Error('Unexpected testnet chain IDs');
  const key = value('CREDITCOIN_WALLET_PRIVATE_KEY');
  if (!key) throw new Error('Missing test wallet key');
  const sourceSigner = new NonceManager(new Wallet(key, sepolia));
  const targetSigner = new NonceManager(new Wallet(key, cc));
  const walletAddress = await sourceSigner.getAddress();
  if (state.recipient && state.recipient.toLowerCase() !== walletAddress.toLowerCase())
    throw new Error('Saved deployment belongs to a different test wallet');
  state.recipient = walletAddress;
  state.caseKey ??= keccak256(toUtf8Bytes('Receipt Arena / season 2026 / training receipts'));
  const balances = await Promise.all([sepolia.getBalance(state.recipient), cc.getBalance(state.recipient)]);
  log(
    'TESTNETS_CHECKED',
    JSON.stringify({
      sourceChain: Number(sourceNetwork.chainId),
      targetChain: Number(targetNetwork.chainId),
      sourceGasAvailable: balances[0] > 0n,
      targetGasAvailable: balances[1] > 0n,
    }),
  );
  if (command === 'inspect') return;
  if (balances.some((amount) => amount === 0n)) throw new Error('Missing testnet gas');

  async function deploy(name, compiled, signer, args = []) {
    if (state[name]) {
      if ((await signer.provider.getCode(state[name])) === '0x')
        throw new Error(`Missing deployment ${name}`);
      return new Contract(state[name], compiled.abi, signer);
    }
    const deployed = await new ContractFactory(compiled.abi, compiled.bytecode.object, signer).deploy(
      ...args,
    );
    state[name] = await deployed.getAddress();
    state.transactions[`deploy_${name}`] = deployed.deploymentTransaction().hash;
    save();
    await deployed.waitForDeployment();
    log('DEPLOYED', `${name} ${state[name]}`);
    return deployed;
  }

  async function transact(name, send) {
    if (state.transactions[name]) {
      const receipt = await (name.startsWith('source_') ? sepolia : cc).getTransactionReceipt(
        state.transactions[name],
      );
      if (!receipt || receipt.status !== 1) throw new Error(`Prior transaction incomplete: ${name}`);
      return receipt;
    }
    const tx = await send();
    state.transactions[name] = tx.hash;
    save();
    log('SENT', `${name} ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error(`Transaction reverted: ${name}`);
    return receipt;
  }

  const genuine = await deploy('genuine', sourceArtifact, sourceSigner);
  const forged = await deploy('forged', sourceArtifact, sourceSigner);
  const registry = await deploy('registry', registryArtifact, targetSigner);
  const arena = await deploy('arena', arenaArtifact, targetSigner, [state.registry]);
  await transact('source_normal', () => genuine.record(state.caseKey, state.recipient, 50));
  await transact('source_forged', () => forged.record(state.caseKey, state.recipient, 50));
  const builder = new proofProvider.service.ProofBuilder(
    1,
    value('PROOF_BUILDER_URL') ?? 'https://prover.cc3-testnet.creditcoin.network',
  );

  async function register(name) {
    if (state.evidence[name]) {
      const saved = state.evidence[name];
      const entry = await registry.getEvidence(saved.id);
      const registration = await cc.getTransactionReceipt(saved.registrationTransaction);
      if (!entry.exists || entry.blockHeight !== BigInt(saved.sourceBlock) || registration?.status !== 1)
        throw new Error('Saved evidence does not match the live registry');
      return saved.id;
    }
    const hash = state.transactions[`source_${name}`];
    const receipt = await sepolia.getTransactionReceipt(hash);
    log('WAIT_ATTESTATION', `${name} block ${receipt.blockNumber}`);
    await builder.waitUntilHeightAttested(1, receipt.blockNumber, 15000, 1200000);
    const response = await builder.getProof(hash);
    if (!response.success) throw new Error('Proof builder returned failure');
    const proof = response.data;
    if (Number(proof.chainKey) !== 1 || Number(proof.headerNumber) !== receipt.blockNumber)
      throw new Error('Proof identity mismatch');
    const txIndex = await new Contract(
      '0x0000000000000000000000000000000000000FD2',
      [
        'function calculateTxIndex((bytes32 root,(bytes32 hash,bool isLeft)[] siblings)) view returns(uint64)',
      ],
      cc,
    ).calculateTxIndex(proof.merkleProof);
    const id = keccak256(
      AbiCoder.defaultAbiCoder().encode(['uint64', 'uint64', 'uint64'], [1, proof.headerNumber, txIndex]),
    );
    writeFileSync(`.local/proof-${name}.json`, JSON.stringify(proof, null, 2));
    const registration = await transact(`register_${name}`, () =>
      registry.register(proof.headerNumber, proof.txBytes, proof.merkleProof, proof.continuityProof),
    );
    const entry = await registry.getEvidence(id);
    if (!entry.exists || entry.transactionDataHash !== keccak256(proof.txBytes))
      throw new Error('Registered evidence mismatch');
    state.evidence[name] = {
      id,
      sourceTransaction: hash,
      sourceBlock: receipt.blockNumber,
      registrationTransaction: registration.hash,
      roots: proof.continuityProof.roots.length,
      gasUsed: registration.gasUsed.toString(),
    };
    save();
    log('EVIDENCE_VERIFIED', name);
    return id;
  }

  const normalId = await register('normal');
  const forgedId = await register('forged');
  const level = (normalEvidence, attackEvidence) => ({
    exists: true,
    expectedEmitter: state.genuine,
    recipient: state.recipient,
    caseKey: state.caseKey,
    normalEvidence,
    attackEvidence,
  });
  await transact('configure_1', () => arena.configureLevel(1, level(normalId, forgedId)));
  const unsafe = await arena.preview(1, 0);
  const safe = await arena.preview(1, 1);
  if (
    unsafe.attackPaid !== 50n ||
    unsafe.cleared ||
    safe.attackPaid !== 0n ||
    safe.normalPaid !== 50n ||
    !safe.cleared
  )
    throw new Error('Level 1 proof integration failed');
  await transact('complete_1', () => arena.complete(1, 1));
  if (!(await arena.completed(state.recipient, 1))) throw new Error('Completion not persisted');
  state.checks.level1 = {
    passed: true,
    checkedAt: new Date().toISOString(),
    unsafeAttackPaid: '50',
    defendedAttackPaid: '0',
    normalPaid: '50',
    completionTransaction: state.transactions.complete_1,
  };
  save();
  log('LEVEL_1_PASSED');

  if (command === 'extend') {
    const router = await deploy('router', routerArtifact, sourceSigner);
    await transact('source_mixed', () =>
      router.mixed(state.forged, state.genuine, state.caseKey, state.recipient, 50),
    );
    const mixedId = await register('mixed');
    await transact('configure_2', () => arena.configureLevel(2, level(normalId, normalId)));
    await transact('configure_3', () => arena.configureLevel(3, level(mixedId, forgedId)));
    for (const [number, rules] of [
      [2, 2],
      [3, 5],
    ]) {
      if (!(await arena.preview(number, rules).then((result) => result.cleared)))
        throw new Error(`Level ${number} not cleared`);
      await transact(`complete_${number}`, () => arena.complete(number, rules));
      if (!(await arena.completed(state.recipient, number)))
        throw new Error(`Level ${number} completion not persisted`);
      state.checks[`level${number}`] = {
        passed: true,
        checkedAt: new Date().toISOString(),
        completionTransaction: state.transactions[`complete_${number}`],
      };
    }
    save();
  }

  const manifest = {
    version: 1,
    sourceChainId: 11155111,
    targetChainId: 102031,
    targetRpc: 'https://rpc.cc3-testnet.creditcoin.network',
    registry: state.registry,
    arena: state.arena,
    genuine: state.genuine,
    forged: state.forged,
    recipient: state.recipient,
    evidence: state.evidence,
    checks: state.checks,
    availableLevels: [1, 2, 3].filter((number) => state.checks[`level${number}`]?.passed),
  };
  writeFileSync('public/deployment.json', JSON.stringify(manifest, null, 2));
  writeFileSync(
    'public/contracts.json',
    JSON.stringify({ arena: arenaArtifact.abi, registry: registryArtifact.abi }, null, 2),
  );
  log('PUBLIC_MANIFEST_SAVED');
}

main()
  .catch((error) => {
    // RPC 자격 증명과 지갑 정보를 포함할 수 있는 원본 예외 객체를 출력하지 않는다.
    console.error('Testnet step failed:', error.shortMessage ?? error.code ?? error.name);
    process.exitCode = 1;
  })
  .finally(() => {
    cc.destroy();
    sepolia.destroy();
  });
