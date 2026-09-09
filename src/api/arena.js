import { BrowserProvider, Contract, FetchRequest, JsonRpcProvider } from 'ethers';

export async function connectArena() {
  const [deploymentResponse, abiResponse] = await Promise.all([
    fetch('/deployment.json', { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
    fetch('/contracts.json', { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
  ]);
  if (!deploymentResponse.ok || !abiResponse.ok)
    throw new Error('테스트넷 배포 정보를 아직 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.');
  const deployment = await deploymentResponse.json();
  const abis = await abiResponse.json();
  if (deployment.version !== 1 || deployment.targetChainId !== 102031)
    throw new Error('지원하지 않는 배포 정보입니다.');
  const request = new FetchRequest(deployment.targetRpc);
  request.timeout = 20000;
  const provider = new JsonRpcProvider(request, undefined, { cacheTimeout: -1 });
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== 102031n) throw new Error('Unexpected network');
    const arena = new Contract(deployment.arena, abis.arena, provider);
    const registry = new Contract(deployment.registry, abis.registry, provider);
    return { deployment, abis, provider, arena, registry };
  } catch (error) {
    provider.destroy();
    throw error;
  }
}

export function normalizeOutcome(result) {
  return {
    normalPaid: Number(result.normalPaid),
    attackPaid: Number(result.attackPaid),
    expectedNormal: Number(result.expectedNormal),
    cleared: result.cleared,
  };
}

export function friendlyError(error = {}) {
  if (error.code === 'ACTION_REJECTED' || error.code === 4001)
    return '지갑 요청을 취소했습니다. 연습은 계속할 수 있습니다.';
  if (error.code === 'INSUFFICIENT_FUNDS')
    return '기록하려면 테스트넷 CTC가 필요합니다. 지갑 없이 연습을 계속할 수 있습니다.';
  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT' || error.name === 'TimeoutError')
    return '네트워크 연결이 지연되고 있습니다. 다시 시도해 주세요.';
  return (
    error.userMessage ?? '요청을 완료하지 못했습니다. 네트워크와 지갑 상태를 확인한 뒤 다시 시도해 주세요.'
  );
}

export async function recordCompletion(context, level, mask) {
  if (!window.ethereum) throw { userMessage: '브라우저 지갑이 없습니다. 지갑 없이 연습은 가능합니다.' };
  const wallet = new BrowserProvider(window.ethereum);
  await wallet.send('eth_requestAccounts', []);
  const network = await wallet.getNetwork();
  if (network.chainId !== 102031n)
    throw { userMessage: '지갑을 Creditcoin CC3 Testnet(102031)으로 전환해 주세요.' };
  const signer = await wallet.getSigner();
  const contract = new Contract(context.deployment.arena, context.abis.arena, signer);
  const tx = await contract.complete(level, mask);
  const receipt = await tx.wait();
  if (receipt.status !== 1 || !(await contract.completed(await signer.getAddress(), level)))
    throw { userMessage: '클리어 기록을 확인하지 못했습니다. 탐색기에서 거래 상태를 확인해 주세요.' };
  return receipt.hash;
}
