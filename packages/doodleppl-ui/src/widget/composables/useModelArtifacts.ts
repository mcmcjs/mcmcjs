import { computed } from 'vue'
import type { Ref } from 'vue'
import { generateStandaloneScript } from '@mcmcjs/doodleppl'
import { generateNotebook, notebookFilename } from '@mcmcjs/doodleppl/notebook'
import type { UnifiedModelData } from '../types'
import {
  extractCensoredFields,
  generateStanDataJson,
  generateStanInitsJson,
  generateStanStandaloneScript,
} from '@mcmcjs/doodleppl/stan'
import { useDataStore } from '../stores/dataStore'
import { useGraphStore } from '../stores/graphStore'
import { useProjectStore } from '../stores/projectStore'
import { useScriptStore } from '../stores/scriptStore'

/** Which backend an artifact targets. The editor calls the BUGS side JuliaBUGS. */
export type ModelTarget = 'juliabugs' | 'stan'

/** One downloadable file derived from the graph. */
export interface Artifact {
  filename: string
  content: string
  mime: string
}

/**
 * Every file the current graph can produce, derived live.
 *
 * These used to be generated on a button press and kept in localStorage, so
 * they went stale as soon as the graph changed, and the same model code was
 * rendered by three different places. They are computed here instead, once,
 * and every panel reads them.
 */
export function useModelArtifacts(bugsCode: Ref<string>, stanCode: Ref<string>) {
  const graphStore = useGraphStore()
  const dataStore = useDataStore()
  const projectStore = useProjectStore()
  const scriptStore = useScriptStore()

  const elements = computed(() => graphStore.currentGraphElements)
  const data = computed(() => (dataStore.parsedGraphData?.data ?? {}) as Record<string, unknown>)
  const inits = computed(() => (dataStore.parsedGraphData?.inits ?? {}) as Record<string, unknown>)

  const modelName = computed(() => {
    const graphs = projectStore.currentProject?.graphs
    return graphs?.find((g) => g.id === graphStore.currentGraphId)?.name ?? 'model'
  })

  const settings = computed(() => ({
    n_samples: scriptStore.samplerSettings.n_samples,
    n_adapts: scriptStore.samplerSettings.n_adapts,
    n_chains: scriptStore.samplerSettings.n_chains,
    seed: scriptStore.samplerSettings.seed ?? undefined,
  }))

  const censoredFields = computed(() => extractCensoredFields(elements.value))

  const modelCode = (target: ModelTarget) =>
    target === 'stan' ? stanCode.value : bugsCode.value

  const juliaScript = computed(() =>
    generateStandaloneScript({
      modelCode: bugsCode.value,
      data: data.value,
      inits: inits.value,
      settings: settings.value,
    })
  )

  const stanScript = computed(() =>
    generateStanStandaloneScript({
      modelCode: stanCode.value,
      data: data.value,
      inits: inits.value,
      elements: elements.value,
      censoredFields: censoredFields.value,
      settings: settings.value,
    })
  )

  const stanDataJson = computed(() => generateStanDataJson(data.value, censoredFields.value))
  const stanInitsJson = computed(() => generateStanInitsJson(inits.value, elements.value))

  /** The graph as a portable document: what the notebook takes as its input. */
  const graphDocument = computed<UnifiedModelData>(() => ({
    name: modelName.value,
    version: 1,
    elements: elements.value,
    dataContent: dataStore.dataContent,
  }))

  const notebook = (target: ModelTarget): string =>
    generateNotebook({
      target,
      name: modelName.value,
      graph: graphDocument.value,
      settings: settings.value,
    })

  /** The model file itself: a BUGS program or a Stan program. */
  const modelArtifact = (target: ModelTarget): Artifact => ({
    filename: target === 'stan' ? 'model.stan' : 'model.bugs',
    content: modelCode(target),
    mime: 'text/plain;charset=utf-8',
  })

  /** A runnable script: Julia for JuliaBUGS, Python for Stan. */
  const scriptArtifact = (target: ModelTarget): Artifact =>
    target === 'stan'
      ? { filename: 'run_stan_model.py', content: stanScript.value, mime: 'text/plain;charset=utf-8' }
      : { filename: 'run_model.jl', content: juliaScript.value, mime: 'text/plain;charset=utf-8' }

  const notebookArtifact = (target: ModelTarget): Artifact => ({
    filename: notebookFilename(modelName.value, target),
    content: notebook(target),
    mime: 'application/x-ipynb+json',
  })

  const dataArtifact = (): Artifact => ({
    filename: 'data.json',
    content: stanDataJson.value,
    mime: 'application/json',
  })

  const initsArtifact = (): Artifact => ({
    filename: 'inits.json',
    content: stanInitsJson.value,
    mime: 'application/json',
  })

  return {
    modelName,
    graphDocument,
    juliaScript,
    stanScript,
    stanDataJson,
    stanInitsJson,
    notebook,
    modelArtifact,
    scriptArtifact,
    notebookArtifact,
    dataArtifact,
    initsArtifact,
  }
}
