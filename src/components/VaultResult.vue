<script setup>
import { computed } from 'vue';
const props = defineProps({
  outcome: { type: Object, default: null },
  testedDefense: Boolean,
  selectedKind: { type: String, required: true },
  current: { type: Object, required: true },
  currentId: { type: Number, required: true },
  recordedTransaction: { type: String, default: '' },
  busy: Boolean,
  isRecording: Boolean,
});
const emit = defineEmits(['record', 'next']);
const cleared = computed(() => props.testedDefense && props.outcome?.cleared);
const selectedPayout = computed(
  () => props.outcome?.[props.selectedKind === 'normal' ? 'normalPaid' : 'attackPaid'],
);
</script>
<template>
  <section class="panel vault-panel" aria-labelledby="vault-heading">
    <div class="panel-title">
      <span class="step-number">2</span>
      <h2 id="vault-heading">금고의 판단</h2>
      <span class="micro-label">RESULT</span>
    </div>
    <div class="vault-stage" :class="{ cleared, exposed: outcome && !outcome.cleared }">
      <span class="orbit orbit-one"></span><span class="orbit orbit-two"></span>
      <div class="vault-body">
        <div class="vault-door">
          <span class="vault-bolt"></span><span class="vault-dial">{{ cleared ? '✓' : '+' }}</span
          ><span class="vault-slot"></span>
        </div>
        <span class="vault-foot"></span>
      </div>
      <span class="vault-status">{{
        cleared ? '정상 지급 보호 완료' : outcome ? '지급 규칙을 살펴보세요' : '요청을 기다리는 중'
      }}</span>
    </div>
    <div class="result-area" aria-live="polite">
      <template v-if="outcome && !testedDefense"
        ><p class="result-caption">{{ selectedKind === 'normal' ? '정상 요청' : '공격 요청' }} 실행 결과</p>
        <p class="payout">{{ selectedPayout }}<span>POINTS 지급</span></p>
        <p class="result-message">
          {{
            selectedKind === 'attack' && selectedPayout > 0
              ? '진짜 증거를 가진 공격자가 지급을 받았습니다.'
              : selectedPayout === 0
                ? '금고가 이 요청을 거부했습니다.'
                : '금고가 정상 요청을 처리했습니다.'
          }}
        </p></template
      >
      <template v-else-if="outcome"
        ><div class="result-row">
          <span>정상 고객</span
          ><strong :class="outcome.normalPaid === outcome.expectedNormal ? 'good' : 'bad'"
            >{{ outcome.normalPaid }} / {{ outcome.expectedNormal }} 지급</strong
          >
        </div>
        <div class="result-row">
          <span>공격자의 추가 지급</span
          ><strong :class="outcome.attackPaid === 0 ? 'good' : 'bad'">{{ outcome.attackPaid }} POINTS</strong>
        </div>
        <p class="result-message">
          {{
            cleared
              ? current.lesson
              : outcome.normalPaid === 0
                ? '공격을 막았지만 정상 고객도 막혔습니다. 규칙을 다시 살펴보세요.'
                : '아직 공격이 통과합니다. 다른 규칙을 조합해 보세요.'
          }}
        </p></template
      >
      <template v-else
        ><p class="empty-result">영수증 한 장이<br />어떤 결과를 만들까요?</p>
        <p class="result-message">
          왼쪽에서 요청을 실행하거나<br />오른쪽 규칙을 수정해 검증하세요.
        </p></template
      >
    </div>
    <div v-if="cleared" class="completion-actions">
      <button
        class="primary-button full-width"
        :disabled="busy || !!recordedTransaction"
        @click="emit('record')"
      >
        {{
          recordedTransaction
            ? '✓ 온체인 기록 확인됨'
            : isRecording
              ? '지갑·채굴 확인 중…'
              : '클리어를 온체인에 기록 ↗'
        }}</button
      ><small>선택 사항 · 지갑과 테스트넷 CTC가 필요합니다</small
      ><a
        v-if="recordedTransaction"
        :href="`https://creditcoin-testnet.blockscout.com/tx/${recordedTransaction}`"
        target="_blank"
        rel="noopener noreferrer"
        >기록 거래 확인 ↗</a
      ><button v-if="currentId < 3" class="text-button" :disabled="busy" @click="emit('next')">
        다음 레벨로 →
      </button>
    </div>
  </section>
</template>
