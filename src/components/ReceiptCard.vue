<script setup>
const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, required: true },
  selected: Boolean,
  disabled: Boolean,
  variant: { type: String, required: true },
});
const emit = defineEmits(['select']);
</script>

<template>
  <button
    class="receipt-card"
    :class="[props.variant, { selected: props.selected }]"
    :disabled="props.disabled"
    :aria-pressed="props.selected"
    @click="emit('select')"
  >
    <span class="receipt-icon" aria-hidden="true">▤</span>
    <span class="receipt-copy"
      ><strong>{{ props.title }}</strong
      ><small>{{ props.subtitle }}</small></span
    >
    <span class="select-indicator" aria-hidden="true">{{ props.selected ? '●' : '○' }}</span>
  </button>
</template>
