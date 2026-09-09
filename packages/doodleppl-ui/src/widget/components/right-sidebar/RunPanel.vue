<script setup lang="ts">
import { computed, ref } from 'vue'
import { colabUrl } from '@mcmcjs/doodleppl/notebook'
import type { ModelTarget } from '../../composables/useModelArtifacts'
import BaseButton from '../ui/BaseButton.vue'

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

const templates = backends.map((b) => ({
  ...b,
  url: colabUrl(`notebooks/template_${b.id}.ipynb`, buildRef),
}))

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

const runtimeNote = computed(() =>
  props.target === 'stan'
    ? 'The notebook installs the CLI and CmdStan on its first run, which takes a few minutes on a fresh Colab runtime.'
    : 'The notebook installs the CLI and Julia on its first run, which takes a few minutes on a fresh Colab runtime.'
)
</script>

<template>
  <div class="db-run-panel">
    <div class="db-run-block">
      <h5 class="db-run-title">Backend</h5>
      <div class="db-run-seg">
        <button
          v-for="backend in backends"
          :key="backend.id"
          type="button"
          :class="{ 'db-active': backend.id === target }"
          @click="emit('update:target', backend.id)"
        >
          {{ backend.label }}
        </button>
      </div>
    </div>

    <div class="db-run-block">
      <h5 class="db-run-title">Run it in a notebook</h5>
      <p class="db-run-note">
        Fits the model, checks convergence, draws the posterior and packages the run for the report
        app. Chains, draws and the seed are set in the notebook.
      </p>
      <BaseButton type="primary" class="db-run-btn" @click="emit('download-notebook')">
        <i class="fas fa-download"></i> Download notebook (.ipynb)
      </BaseButton>
      <a
        v-for="template in templates"
        :key="template.id"
        class="db-run-link"
        :class="{ 'db-run-link-on': template.id === target }"
        :href="template.url"
        target="_blank"
        rel="noopener noreferrer"
      >
        <i class="fas fa-external-link-alt"></i> {{ template.label }} in Colab
      </a>
      <button type="button" class="db-run-link" @click="copyGraph">
        <i
          :class="
            copied ? 'fas fa-check' : copyFailed ? 'fas fa-exclamation-triangle' : 'fas fa-copy'
          "
        ></i>
        {{ copied ? 'Graph copied' : copyFailed ? 'Copy failed, use Download' : 'Copy graph' }}
      </button>
      <p class="db-run-note">
        Colab cannot open a notebook built on this page, so the links open a blank template: press
        <strong>Copy graph</strong> and paste it into the template's first cell. Downloading gives
        you a notebook with this graph already in it.
      </p>
      <p class="db-run-note">{{ runtimeNote }}</p>
    </div>
  </div>
</template>

<style scoped>
.db-run-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 12px;
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
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--db-text-muted, #777);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.db-run-seg {
  display: inline-flex;
  border: 1px solid var(--db-border-color, #ccc);
  border-radius: 4px;
  overflow: hidden;
}
.db-run-seg button {
  flex: 1;
  border: 0;
  background: none;
  padding: 6px 10px;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  color: var(--db-text-color, #222);
}
.db-run-seg button.db-active {
  background: var(--db-text-color, #222);
  color: var(--db-bg-color, #fff);
}
.db-run-btn {
  width: 100%;
}
.db-run-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid var(--db-border-color, #ccc);
  border-radius: 4px;
  background: none;
  color: var(--db-text-color, #222);
  text-decoration: none;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.db-run-link:hover {
  background: var(--db-hover-bg, #f2f2f2);
}
.db-run-link-on {
  border-color: var(--db-text-color, #222);
}
.db-run-note {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--db-text-muted, #777);
}
.db-run-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 10px;
  align-items: center;
}
.db-run-grid label {
  font-size: 0.8rem;
  color: var(--db-text-color, #222);
}
</style>
