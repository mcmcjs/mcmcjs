import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface SamplerSettings {
  n_samples: number
  n_adapts: number
  n_chains: number
  seed?: number | null
}

const DEFAULTS: SamplerSettings = { n_samples: 1000, n_adapts: 1000, n_chains: 1, seed: null }

/**
 * The sampler settings every generated script and notebook is built with.
 *
 * The generated scripts themselves used to live here, written to localStorage
 * on a button press, which meant they went stale the moment the graph changed.
 * They are derived from the graph now (see `useModelArtifacts`); only these
 * settings are state, because only they are the user's choice.
 */
export const useScriptStore = defineStore('script', () => {
  let prefix = 'doodlebugs'
  let suppressWatch = false

  const key = () => `${prefix}-samplerSettings`

  const read = (): SamplerSettings => {
    const stored = localStorage.getItem(key())
    if (!stored) return { ...DEFAULTS }
    try {
      return { ...DEFAULTS, ...(JSON.parse(stored) as Partial<SamplerSettings>) }
    } catch {
      return { ...DEFAULTS }
    }
  }

  const samplerSettings = ref<SamplerSettings>(read())

  const setPrefix = (p: string) => {
    suppressWatch = true
    prefix = p
    samplerSettings.value = read()
    suppressWatch = false
  }

  watch(
    samplerSettings,
    (v) => {
      if (!suppressWatch) localStorage.setItem(key(), JSON.stringify(v))
    },
    { deep: true }
  )

  return { samplerSettings, setPrefix }
})
