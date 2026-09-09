<script setup lang="ts">
import { computed, ref } from 'vue'
import { colabUrl } from '@mcmcjs/doodleppl/notebook'
import type { ModelTarget } from '../../composables/useModelArtifacts'

const props = defineProps<{
  /** The backend every generated file targets, shared with the code panel. */
  target: ModelTarget
  /** The graph document, for pasting into a notebook opened in Colab. */
  graphJson: string
}>()

const emit = defineEmits<{
  (e: 'update:target', target: ModelTarget): void
  (e: 'download-notebook'): void
}>()

// The ref the build came from, so the Colab links point at a branch that
// carries notebooks/: a PR preview at its own branch, a release at main.
declare const __DOODLEPPL_REF__: string
const buildRef = typeof __DOODLEPPL_REF__ === 'string' ? __DOODLEPPL_REF__ : 'main'

const backends: { id: ModelTarget; label: string }[] = [
  { id: 'juliabugs', label: 'JuliaBUGS' },
  { id: 'stan', label: 'Stan' },
]

const label = computed(() => (props.target === 'stan' ? 'Stan' : 'JuliaBUGS'))
const colabHref = computed(() => colabUrl(`notebooks/template_${props.target}.ipynb`, buildRef))

const copied = ref(false)
const copyFailed = ref(false)

/**
 * The clipboard API needs a focused document and a secure context, and is
 * refused outright in some embeddings, so a hidden textarea is the fallback.
 * A failure has to show: the paste route is useless if the copy quietly did
 * not happen.
 */
const copyGraph = async () => {
  const done = (ok: boolean) => {
    copied.value = ok
    copyFailed.value = !ok
    setTimeout(() => {
      copied.value = false
      copyFailed.value = false
    }, 2000)
  }
  try {
    await navigator.clipboard.writeText(props.graphJson)
    done(true)
    return
  } catch {
    // Fall through to the textarea.
  }
  const area = document.createElement('textarea')
  area.value = props.graphJson
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.focus()
  area.select()
  try {
    done(document.execCommand('copy'))
  } catch {
    done(false)
  } finally {
    document.body.removeChild(area)
  }
}

const copyIcon = computed(() => {
  if (copied.value) return 'fas fa-check'
  return copyFailed.value ? 'fas fa-triangle-exclamation' : 'far fa-copy'
})
const copyLabel = computed(() => {
  if (copied.value) return 'Copied'
  return copyFailed.value ? 'Copy failed' : 'Copy graph'
})
</script>

<template>
  <div class="db-run-panel">
    <section class="db-run-block">
      <h5 class="db-run-title">Backend</h5>
      <div class="db-seg">
        <button
          v-for="backend in backends"
          :key="backend.id"
          type="button"
          :class="{ 'db-on': backend.id === target }"
          :aria-pressed="backend.id === target"
          @click="emit('update:target', backend.id)"
        >
          {{ backend.label }}
        </button>
      </div>
    </section>

    <section class="db-run-block">
      <h5 class="db-run-title">Run</h5>
      <a class="db-run-primary" :href="colabHref" target="_blank" rel="noopener noreferrer">
        <i class="fas fa-play"></i> Open in Colab
      </a>
      <p class="db-run-hint">The template opens empty. Paste the graph into its first cell.</p>
      <div class="db-run-actions">
        <button
          type="button"
          class="db-run-action"
          :class="{ 'db-warn': copyFailed }"
          @click="copyGraph"
        >
          <i :class="copyIcon"></i> {{ copyLabel }}
        </button>
        <button type="button" class="db-run-action" @click="emit('download-notebook')">
          <i class="fas fa-download"></i> Notebook (.ipynb)
        </button>
      </div>
    </section>

    <details class="db-run-help">
      <summary><i class="fas fa-chevron-right"></i> How this works</summary>
      <ul>
        <li>Downloading gives you the same notebook with this graph already in it, so there is nothing to paste.</li>
        <li>The notebook fits the model, checks convergence, plots the posterior and writes a run bundle for the report app.</li>
        <li>Chains, draws and the seed sit at the top of the notebook.</li>
        <li>The first run installs the CLI and {{ label }}, which takes a few minutes on a fresh Colab runtime.</li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.db-run-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 14px 12px;
  overflow-y: auto;
  height: 100%;
}
.db-run-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.db-run-title {
  margin: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--theme-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* A recessed track with a raised thumb, so the choice reads at a glance. */
.db-seg {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 2px;
  padding: 2px;
  background: var(--theme-bg-canvas);
  border: 1px solid var(--theme-border);
  border-radius: var(--radius-sm);
}
.db-seg button {
  border: 0;
  background: none;
  border-radius: 4px;
  padding: 6px 8px;
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--theme-text-secondary);
  cursor: pointer;
  transition:
    background-color 0.15s,
    color 0.15s,
    box-shadow 0.15s;
}
.db-seg button:hover:not(.db-on) {
  color: var(--theme-text-primary);
}
.db-seg button.db-on {
  background: var(--theme-bg-panel);
  color: var(--theme-text-primary);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.db-run-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  background: var(--theme-primary);
  color: #fff;
  font-size: var(--font-size-md);
  font-weight: 600;
  text-decoration: none;
  transition: background-color 0.15s;
}
.db-run-primary:hover {
  background: var(--theme-primary-hover);
}
.db-run-primary i {
  font-size: 0.7em;
}

.db-run-hint {
  margin: 0;
  font-size: var(--font-size-xs);
  line-height: 1.5;
  color: var(--theme-text-muted);
}

.db-run-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 2px;
}
.db-run-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 8px;
  border: 1px solid var(--theme-border);
  border-radius: var(--radius-sm);
  background: var(--theme-bg-panel);
  color: var(--theme-text-secondary);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition:
    background-color 0.15s,
    border-color 0.15s,
    color 0.15s;
}
.db-run-action:hover {
  background: var(--theme-bg-hover);
  border-color: var(--theme-border-hover);
  color: var(--theme-text-primary);
}
.db-run-action.db-warn {
  color: var(--theme-danger);
  border-color: var(--theme-danger);
}

.db-run-help {
  border-top: 1px solid var(--theme-border);
  padding-top: 12px;
}
.db-run-help summary {
  cursor: pointer;
  list-style: none;
  font-size: var(--font-size-sm);
  color: var(--theme-text-secondary);
}
.db-run-help summary::-webkit-details-marker {
  display: none;
}
.db-run-help summary i {
  display: inline-block;
  width: 10px;
  font-size: 0.7em;
  color: var(--theme-text-muted);
  transition: transform 0.15s;
}
.db-run-help[open] summary i {
  transform: rotate(90deg);
}
.db-run-help summary:hover {
  color: var(--theme-text-primary);
}
.db-run-help ul {
  margin: 10px 0 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.db-run-help li {
  font-size: var(--font-size-xs);
  line-height: 1.5;
  color: var(--theme-text-muted);
}
</style>
