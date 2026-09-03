<script setup lang="ts">
import { Check, CircleHelp, Eye, RotateCcw, ShieldCheck } from 'lucide-vue-next'
import type { EvaluationResult, TaskRecord } from '../types/protocol'
defineProps<{ evaluation: EvaluationResult | null; task: TaskRecord | null; mode: 'lab' | 'desktop'; nativeLab?: boolean }>()
</script>

<template>
  <section class="evaluation-panel panel">
    <div class="section-heading"><span class="eyebrow">02 / THE CHECK</span><Eye :size="16" /></div>
    <div class="evaluation-heading"><h2>Trust, then verify.</h2><span v-if="evaluation" class="confidence-pill">{{ Math.round(evaluation.confidence * 100) }}% confidence</span></div>
    <div class="evaluation-result" :class="{ positive: evaluation?.result, negative: evaluation && !evaluation.result }"><div class="result-symbol"><Check v-if="evaluation?.result" :size="18" /><RotateCcw v-else-if="evaluation" :size="17" /><CircleHelp v-else :size="18" /></div><div><strong>{{ evaluation ? evaluation.result ? 'Expected state confirmed' : 'Recovery needed' : 'Ready for the first observation' }}</strong><p>{{ evaluation?.explanation || 'Every action leaves a record. The next observation checks what changed.' }}</p></div></div>
    <div class="condition-row"><span>Looking for</span><p>{{ task?.verification.condition || (mode === 'lab' ? 'The character is actively chopping a tree' : 'A condition supplied by your agent') }}</p></div>
    <div class="evaluator-caption"><ShieldCheck :size="13" /><span>{{ mode === 'lab' ? 'Deterministic visual evaluator · no API key' : nativeLab ? 'Deterministic visual evaluator · native screenshots' : 'External WebMCP agent · provider independent' }}</span></div>
  </section>
</template>
