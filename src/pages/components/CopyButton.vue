<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { Copy, Check } from 'lucide-vue-next'
const props = withDefaults(defineProps<{text:string;label?:string}>(),{label:'Copy'})
const status = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
async function copy() {
  try { await navigator.clipboard.writeText(props.text); status.value = 'Copied' }
  catch { status.value = 'Copy unavailable. Select the text to copy it.' }
  clearTimeout(timer); timer = setTimeout(() => { status.value = '' }, 3500)
}
onUnmounted(() => clearTimeout(timer))
</script>
<template><span class="copy-control"><button type="button" class="button button-small" :aria-label="label" @click="copy"><Check v-if="status === 'Copied'" :size="14"/><Copy v-else :size="14"/>{{ status === 'Copied' ? status : label }}</button><span class="copy-status" role="status">{{ status && status !== 'Copied' ? status : status === 'Copied' ? `${label}: copied` : '' }}</span></span></template>
<style scoped>.copy-control{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}.copy-control .button{font-size:12px;min-height:36px;color:var(--ink);border-color:#aab5a5}.copy-status{font-size:12px;color:#365846}.copy-status:empty{display:none}@media print{.copy-control{display:none}}</style>
