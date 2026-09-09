<script setup>
const props = defineProps({ rule: { type: Object, required: true }, active: Boolean, disabled: Boolean });
const emit = defineEmits(['toggle']);
</script>

<template>
  <label class="rule-switch" :class="{ active: props.active }">
    <span class="rule-heading"
      ><strong>{{ props.rule.title }}</strong
      ><input
        type="checkbox"
        :checked="props.active"
        :disabled="props.disabled"
        @change="emit('toggle', props.rule.bit)"
    /></span>
    <small>{{ props.rule.description }}</small>
    <code>{{ props.rule.code }}</code>
  </label>
</template>
