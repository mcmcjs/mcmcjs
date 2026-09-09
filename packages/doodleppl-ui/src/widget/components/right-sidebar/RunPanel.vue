<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { colabUrl } from '@mcmcjs/doodleppl/notebook'
import { useScriptStore } from '../../stores/scriptStore'
import type { Artifact, ModelTarget } from '../../composables/useModelArtifacts'
import BaseButton from '../ui/BaseButton.vue'
import BaseInput from '../ui/BaseInput.vue'

const props = defineProps<{
  target: ModelTarget
  /** The notebook for the selected target, as `.ipynb` JSON. */
  notebook: string
  /** The runnable script behind it, offered as a plain file too. */
  script: Artifact
}>()

// The ref the build came from, so the Colab links point at a branch that
// carries notebooks/: a PR preview at its own branch, a release at main.
declare const __DOODLEPPL_REF__: string
const buildRef = typeof __DOODLEPPL_REF__ === 'string' ? __DOODLEPPL_REF__ : 'main'

const emit = defineEmits<{
  (e: 'download', artifact: Artifact): void
  (e: 'download-notebook'): void
}>()

const scriptStore = useScriptStore()
const { samplerSettings } = storeToRefs(scriptStore)

interface PreviewCell {
  kind: 'markdown' | 'code'
  text: string
}

/** The notebook's cells, for reading in the panel. */
const cells = computed<PreviewCell[]>(() => {
  try {
    const parsed = JSON.parse(props.notebook) as {
      cells: { cell_type: string; source: string[] }[]
    }
    return parsed.cells.map((c) => ({
      kind: c.cell_type === 'markdown' ? 'markdown' : 'code',
      text: c.source.join(''),
    }))
  } catch {
    return []
  }
})

// Colab opens a notebook from GitHub or Drive only, never from this page, so
// these open ready-made ones and the model's own notebook is downloaded.
const examples = [
  { target: 'juliabugs' as ModelTarget, label: 'JuliaBUGS in Colab', path: 'notebooks/rats_juliabugs.ipynb' },
  { target: 'stan' as ModelTarget, label: 'Stan in Colab', path: 'notebooks/rats_stan.ipynb' },
].map((e) => ({ ...e, url: colabUrl(e.path, buildRef) }))

const runtimeNote = computed(() =>
  props.target === 'stan'
    ? 'Installs the CLI and CmdStan on the first run, which takes a few minutes on a fresh Colab runtime.'
    : 'Installs the CLI and Julia on the first run, which takes a few minutes on a fresh Colab runtime.'
)
</script>

<template>
  <div class="db-run-panel">
    <div class="db-run-actions">
      <BaseButton type="primary" class="db-run-btn" @click="emit('download-notebook')">
        <i class="fas fa-download"></i> Download notebook (.ipynb)
      </BaseButton>
      <a
        v-for="example in examples"
        :key="example.target"
        class="db-run-colab"
        :class="{ 'db-run-colab-on': example.target === target }"
        :href="example.url"
        target="_blank"
        rel="noopener noreferrer"
      >
        <i class="fas fa-external-link-alt"></i> {{ example.label }}
      </a>
      <p class="db-run-note">
        The notebook runs the whole workflow with the <code>mcmc</code> CLI: fit, convergence
        checks, plots, and a run bundle for the report app. Colab can only open notebooks from
        GitHub, so these open a ready-made example; download yours and upload it to run your own
        model.
      </p>
      <p class="db-run-note">{{ runtimeNote }}</p>
    </div>

    <div class="db-run-settings">
      <h5 class="db-run-title">Sampler</h5>
      <div class="db-run-grid">
        <label for="db-run-samples">Samples</label>
        <BaseInput id="db-run-samples" type="number" v-model.number="samplerSettings.n_samples" />
        <label for="db-run-adapts">Adaptation</label>
        <BaseInput id="db-run-adapts" type="number" v-model.number="samplerSettings.n_adapts" />
        <label for="db-run-chains">Chains</label>
        <BaseInput id="db-run-chains" type="number" v-model.number="samplerSettings.n_chains" />
        <label for="db-run-seed">Seed</label>
        <BaseInput id="db-run-seed" type="number" v-model.number="samplerSettings.seed" />
      </div>
    </div>

    <div class="db-run-preview">
      <div class="db-run-preview-head">
        <h5 class="db-run-title">Notebook</h5>
        <button
          class="db-run-icon"
          type="button"
          :title="`Download ${script.filename}`"
          @click="emit('download', script)"
        >
          <i class="fas fa-file-code"></i> {{ script.filename }}
        </button>
      </div>
      <div v-for="(cell, i) in cells" :key="i" class="db-run-cell" :class="`db-run-${cell.kind}`">
        <pre>{{ cell.text }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.db-run-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px;
  overflow-y: auto;
  height: 100%;
}
.db-run-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.db-run-btn {
  width: 100%;
}
.db-run-colab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid var(--db-border-color, #ccc);
  border-radius: 4px;
  color: var(--db-text-color, #222);
  text-decoration: none;
  font-size: 0.85rem;
}
.db-run-colab:hover {
  background: var(--db-hover-bg, #f2f2f2);
}
.db-run-colab-on {
  border-color: var(--db-text-color, #222);
}
.db-run-note {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--db-text-muted, #777);
}
.db-run-title {
  margin: 0 0 6px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--db-text-muted, #777);
  text-transform: uppercase;
  letter-spacing: 0.04em;
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
.db-run-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.db-run-icon {
  background: none;
  border: 0;
  cursor: pointer;
  color: var(--db-text-muted, #777);
  font-size: 0.75rem;
  display: inline-flex;
  gap: 5px;
  align-items: center;
}
.db-run-icon:hover {
  color: var(--db-text-color, #222);
}
.db-run-cell {
  border-left: 2px solid var(--db-border-color, #ddd);
  padding: 4px 0 4px 10px;
  margin-bottom: 8px;
}
.db-run-cell pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.72rem;
  line-height: 1.5;
}
.db-run-markdown {
  border-left-color: transparent;
}
.db-run-markdown pre {
  font-family: inherit;
  font-size: 0.78rem;
  color: var(--db-text-muted, #777);
}
.db-run-code pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
