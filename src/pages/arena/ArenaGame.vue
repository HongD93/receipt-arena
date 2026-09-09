<script setup>
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { connectArena, friendlyError, normalizeOutcome, recordCompletion } from '../../api/arena.js';
import { levels, rules } from '../../data/levels.js';
import ReceiptCard from '../../components/ReceiptCard.vue';
import RuleSwitch from '../../components/RuleSwitch.vue';
import VaultResult from '../../components/VaultResult.vue';

const currentId = ref(1);
const mask = ref(0);
const selectedKind = ref('attack');
const isLoading = ref(true);
const isRunning = ref(false);
const isRecording = ref(false);
const error = ref('');
const context = shallowRef(null);
const evidence = ref({});
const outcome = ref(null);
const testedDefense = ref(false);
const hintVisible = ref(false);
const completedPractice = ref(new Set());
const recordedTransactions = ref({});
let requestVersion = 0;
let connectionVersion = 0;

const current = computed(() => levels.find((level) => level.id === currentId.value));
const available = computed(() => context.value?.deployment.availableLevels ?? []);
const selectedName = computed(() => current.value[selectedKind.value]);
const selectedEvidence = computed(() => evidence.value[selectedName.value]);
const evidenceMeta = computed(() => context.value?.deployment.evidence[selectedName.value]);
const ready = computed(
  () => !isLoading.value && available.value.includes(currentId.value) && selectedEvidence.value?.exists,
);
const busy = computed(() => isRunning.value || isRecording.value);
const cleared = computed(() => testedDefense.value && outcome.value?.cleared);
const progress = computed(() => `${completedPractice.value.size} / 3`);

function short(value) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—';
}

async function load() {
  const version = ++connectionVersion;
  isLoading.value = true;
  error.value = '';
  let connected;
  try {
    connected = await connectArena();
    const entries = await Promise.all(
      Object.entries(connected.deployment.evidence).map(async ([name, meta]) => [
        name,
        await connected.registry.getEvidence(meta.id),
      ]),
    );
    if (version !== connectionVersion) {
      connected.provider.destroy();
      return;
    }
    context.value?.provider.destroy();
    context.value = connected;
    evidence.value = Object.fromEntries(entries);
  } catch (problem) {
    connected?.provider.destroy();
    if (version === connectionVersion)
      error.value =
        problem instanceof SyntaxError
          ? '배포 정보를 준비 중입니다. 잠시 후 다시 연결해 주세요.'
          : friendlyError(problem);
  } finally {
    if (version === connectionVersion) isLoading.value = false;
  }
}

function changeLevel(id) {
  requestVersion++;
  currentId.value = id;
  mask.value = levels.find((level) => level.id === id).baseline;
  selectedKind.value = 'attack';
  outcome.value = null;
  testedDefense.value = false;
  hintVisible.value = false;
  error.value = '';
  isRunning.value = false;
}

function toggleRule(bit) {
  requestVersion++;
  mask.value ^= bit;
  outcome.value = null;
  testedDefense.value = false;
  error.value = '';
}

function selectReceipt(kind) {
  selectedKind.value = kind;
  if (!testedDefense.value) outcome.value = null;
}

async function run(defense) {
  if (!ready.value || busy.value) return;
  const version = ++requestVersion;
  const id = currentId.value;
  isRunning.value = true;
  error.value = '';
  try {
    const result = normalizeOutcome(await context.value.arena.preview(id, mask.value));
    if (version !== requestVersion) return;
    outcome.value = result;
    testedDefense.value = defense;
    if (defense && result.cleared) completedPractice.value = new Set([...completedPractice.value, id]);
  } catch (problem) {
    if (version === requestVersion) error.value = friendlyError(problem);
  } finally {
    if (version === requestVersion) isRunning.value = false;
  }
}

async function record() {
  if (!cleared.value || busy.value) return;
  const id = currentId.value;
  isRecording.value = true;
  error.value = '';
  try {
    recordedTransactions.value = {
      ...recordedTransactions.value,
      [id]: await recordCompletion(context.value, id, mask.value),
    };
  } catch (problem) {
    error.value = friendlyError(problem);
  } finally {
    isRecording.value = false;
  }
}

onMounted(load);
onUnmounted(() => {
  connectionVersion++;
  requestVersion++;
  context.value?.provider.destroy();
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Receipt Arena 처음으로"
        ><span class="brand-mark" aria-hidden="true">▤</span>RECEIPT<span>ARENA</span></a
      >
      <div class="topbar-right">
        <span class="network-pill"
          ><i :class="{ online: ready }"></i
          >{{ isLoading ? '체인 연결 중' : ready ? 'CC3 TESTNET' : '연결 확인 필요' }}</span
        ><span class="season">SEASON 01</span>
      </div>
    </header>

    <main>
      <section class="intro">
        <div>
          <p class="eyebrow">A CROSS-CHAIN SECURITY PUZZLE</p>
          <h1>증거는 진짜.<br /><span>지급도 정당할까요?</span></h1>
          <p class="intro-copy">
            공격자의 영수증을 살펴보고, 금고의 규칙을 고치세요.<br class="desktop-break" />
            정상 고객의 지급까지 지켜내면 당신의 승리입니다.
          </p>
        </div>
        <div class="progress-note">
          <span class="progress-number">{{ progress }}</span
          ><span>연습 완료</span><small>지갑 없이 시작할 수 있어요</small>
        </div>
      </section>

      <nav class="level-nav" aria-label="레벨 선택">
        <button
          v-for="level in levels"
          :key="level.id"
          :class="{ active: currentId === level.id }"
          :disabled="isRecording"
          @click="changeLevel(level.id)"
        >
          <span class="level-number">{{ completedPractice.has(level.id) ? '✓' : level.number }}</span
          ><span
            ><small>{{ level.subtitle }}</small
            ><strong>{{ level.title }}</strong></span
          ><span class="level-arrow" aria-hidden="true">↗</span>
        </button>
      </nav>

      <section class="mission">
        <span class="tag">MISSION {{ current.number }}</span>
        <p>{{ current.story }}</p>
        <button class="text-button" @click="hintVisible = !hintVisible">
          {{ hintVisible ? '힌트 닫기 −' : '힌트 보기 +' }}
        </button>
      </section>
      <p v-if="hintVisible" class="hint">{{ current.hint }}</p>
      <div v-if="error" class="error-banner" role="alert">
        <span>{{ error }}</span
        ><button v-if="!context" :disabled="isLoading" @click="load">다시 연결</button>
      </div>
      <div v-if="!isLoading && context && !available.includes(currentId)" class="notice" role="status">
        이 레벨의 실제 증거를 준비하고 있습니다. 준비된 레벨에서 먼저 연습해 주세요.
      </div>

      <div class="game-grid">
        <section class="panel evidence-panel" aria-labelledby="evidence-heading">
          <div class="panel-title">
            <span class="step-number">1</span>
            <h2 id="evidence-heading">영수증을 고르세요</h2>
            <span class="micro-label">EVIDENCE</span>
          </div>
          <ReceiptCard
            title="정상 요청"
            :subtitle="current.id === 3 ? '여러 로그가 담긴 영수증' : '처음 제출한 지급 요청'"
            :selected="selectedKind === 'normal'"
            :disabled="!ready || busy"
            variant="normal"
            @select="selectReceipt('normal')"
          />
          <ReceiptCard
            :title="current.id === 2 ? '같은 영수증 재제출' : '공격 요청'"
            :subtitle="current.id === 2 ? '이미 처리한 요청을 다시 제출' : '진짜 증거, 의심스러운 지급'"
            :selected="selectedKind === 'attack'"
            :disabled="!ready || busy"
            variant="attack"
            @select="selectReceipt('attack')"
          />
          <div class="receipt-detail">
            <div class="receipt-detail-heading">
              <span>PAYMENT RECEIPT</span
              ><span class="verified-label">{{
                selectedEvidence?.exists ? '✓ 실제 증명 등록됨' : '증거 확인 중'
              }}</span>
            </div>
            <dl>
              <div>
                <dt>소스 체인</dt>
                <dd>Ethereum Sepolia</dd>
              </div>
              <div>
                <dt>증거 ID</dt>
                <dd :title="evidenceMeta?.id">{{ short(evidenceMeta?.id) }}</dd>
              </div>
              <div>
                <dt>로그 수</dt>
                <dd>{{ selectedEvidence?.logs.length ?? '—' }}</dd>
              </div>
            </dl>
            <div v-for="(entry, index) in selectedEvidence?.logs ?? []" :key="index" class="log-entry">
              <span class="log-index">LOG {{ index }}</span>
              <dl>
                <div>
                  <dt>발행자</dt>
                  <dd :title="entry.emitter">{{ short(entry.emitter) }}</dd>
                </div>
                <div>
                  <dt>금액</dt>
                  <dd>{{ entry.amount.toString() }} POINTS</dd>
                </div>
              </dl>
            </div>
            <a
              v-if="evidenceMeta"
              class="receipt-link"
              :href="`https://sepolia.etherscan.io/tx/${evidenceMeta.sourceTransaction}`"
              target="_blank"
              rel="noopener noreferrer"
              >원본 거래 확인 ↗</a
            >
          </div>
          <button class="secondary-button full-width" :disabled="!ready || busy" @click="run(false)">
            {{ isRunning ? '계약에서 확인 중…' : '선택한 요청 실행 →' }}
          </button>
        </section>

        <VaultResult
          :outcome="outcome"
          :tested-defense="testedDefense"
          :selected-kind="selectedKind"
          :current="current"
          :current-id="currentId"
          :recorded-transaction="recordedTransactions[currentId]"
          :busy="busy"
          :is-recording="isRecording"
          @record="record"
          @next="changeLevel(currentId + 1)"
        />

        <section class="panel rules-panel" aria-labelledby="rules-heading">
          <div class="panel-title">
            <span class="step-number">3</span>
            <h2 id="rules-heading">규칙을 고치세요</h2>
            <span class="micro-label">DEFENSE</span>
          </div>
          <p class="panel-description">
            공격은 막고, 정상 요청은 통과시키세요.<br />필요한 규칙을 조합할 수 있습니다.
          </p>
          <RuleSwitch
            v-for="rule in rules"
            :key="rule.bit"
            :rule="rule"
            :active="!!(mask & rule.bit)"
            :disabled="!ready || busy"
            @toggle="toggleRule"
          />
          <button class="primary-button full-width" :disabled="!ready || busy" @click="run(true)">
            {{ isRunning ? '계약에서 검증 중…' : '방어 규칙 검증 →' }}
          </button>
          <p class="rules-footnote">정상 요청과 공격 요청을 함께 검사합니다.</p>
        </section>
      </div>

      <section class="provenance">
        <span class="provenance-mark" aria-hidden="true">◈</span>
        <div>
          <strong>사실의 검증에서, 올바른 판단까지.</strong>
          <p>
            {{
              ready
                ? '실제 Sepolia 영수증의 Attestcoin 검증·등록을 확인했습니다.'
                : '실제 증명의 검증·등록 상태를 확인하고 있습니다.'
            }}
            반복 연습은 등록된 증거를 이용한 Creditcoin 계약 조회로 판정합니다. 금고의 포인트는 학습용
            수치입니다.
          </p>
        </div>
        <span class="protocol-label">POWERED BY<br /><strong>ATTESTCOIN</strong></span>
      </section>
    </main>
    <footer><span>RECEIPT ARENA · BUIDL CTC 2026</span><span>증거는 진짜. 규칙은 당신의 선택.</span></footer>
  </div>
</template>
