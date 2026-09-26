import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { GraphElement, ModelLanguage } from '../types'
import { useDataStore } from './dataStore'

export interface GraphContent {
  graphId: string
  elements: GraphElement[]
  lastLayout?: string
  zoom?: number
  pan?: { x: number; y: number }
  /** The language the graph was imported from; validation applies its name rules. */
  language?: ModelLanguage
  /** A layout to run once, the first time the canvas renders this graph. */
  pendingLayout?: string
}

export const useGraphStore = defineStore('graph', () => {
  const dataStore = useDataStore()
  const storagePrefix = ref('doodlebugs')

  const currentGraphKey = computed(() => `${storagePrefix.value}-currentGraphId`)
  const graphContentKey = (id: string) => `${storagePrefix.value}-graph-${id}`

  const graphContents = ref<Map<string, GraphContent>>(new Map())
  const currentGraphId = ref<string | null>(localStorage.getItem(currentGraphKey.value) || null)
  const stateVersion = ref(0)

  const selectedElement = ref<GraphElement | null>(null)

  const setPrefix = (prefix: string) => {
    storagePrefix.value = prefix
    currentGraphId.value = localStorage.getItem(currentGraphKey.value) || null
    // Clear in-memory cache to force reload from new prefix if needed
    graphContents.value.clear()
    if (currentGraphId.value) {
      loadGraph(currentGraphId.value)
    }
  }

  watch(currentGraphId, (newId) => {
    if (newId) {
      localStorage.setItem(currentGraphKey.value, newId)
    } else {
      localStorage.removeItem(currentGraphKey.value)
    }
  })

  const currentGraphElements = computed<GraphElement[]>(() => {
    if (currentGraphId.value && graphContents.value.has(currentGraphId.value)) {
      return graphContents.value.get(currentGraphId.value)!.elements
    }
    return []
  })

  const selectGraph = (graphId: string | null) => {
    currentGraphId.value = graphId
    if (graphId && !graphContents.value.has(graphId)) {
      loadGraph(graphId)
    }
  }

  const setSelectedElement = (element: GraphElement | null) => {
    selectedElement.value = element
  }

  const createNewGraphContent = (graphId: string) => {
    const newContent: GraphContent = {
      graphId: graphId,
      elements: [],
      lastLayout: 'dagre',
    }
    // Ensure reactivity
    graphContents.value.set(graphId, newContent)
    stateVersion.value++
    saveGraph(graphId, newContent)
    dataStore.createNewGraphData(graphId)
  }

  const updateGraphElements = (graphId: string, newElements: GraphElement[]) => {
    if (graphContents.value.has(graphId)) {
      const content = graphContents.value.get(graphId)!
      const newContent = { ...content, elements: newElements }
      graphContents.value.set(graphId, newContent)
      stateVersion.value++
      saveGraph(graphId, newContent)
    }
  }

  const updateGraphLayout = (graphId: string, layoutName: string) => {
    if (graphContents.value.has(graphId)) {
      const content = graphContents.value.get(graphId)!
      if (content.lastLayout !== layoutName) {
        const newContent = { ...content, lastLayout: layoutName }
        graphContents.value.set(graphId, newContent)
        stateVersion.value++
        saveGraph(graphId, newContent)
      }
    }
  }

  const patchGraphContent = (graphId: string, patch: Partial<GraphContent>) => {
    const content = graphContents.value.get(graphId)
    if (!content) return
    const newContent = { ...content, ...patch }
    graphContents.value.set(graphId, newContent)
    stateVersion.value++
    saveGraph(graphId, newContent)
  }

  const setGraphLanguage = (graphId: string, language: ModelLanguage | undefined) =>
    patchGraphContent(graphId, { language })

  /** Queue a layout to run the first time the canvas renders this graph. */
  const setPendingLayout = (graphId: string, layoutName: string | undefined) =>
    patchGraphContent(graphId, { pendingLayout: layoutName })

  /** The queued layout, cleared so it runs once. */
  const takePendingLayout = (graphId: string): string | undefined => {
    const name = graphContents.value.get(graphId)?.pendingLayout
    if (name) patchGraphContent(graphId, { pendingLayout: undefined })
    return name
  }

  const updateGraphViewport = (graphId: string, zoom: number, pan: { x: number; y: number }) => {
    if (graphContents.value.has(graphId)) {
      const content = graphContents.value.get(graphId)!
      const newContent = { ...content, zoom, pan }
      graphContents.value.set(graphId, newContent)
      stateVersion.value++
      saveGraph(graphId, newContent)
    }
  }

  const deleteGraphContent = (graphId: string) => {
    graphContents.value.delete(graphId)
    stateVersion.value++
    localStorage.removeItem(graphContentKey(graphId))
    dataStore.deleteGraphData(graphId)
    if (currentGraphId.value === graphId) {
      selectGraph(null)
    }
  }

  const saveGraph = (graphId: string, content: GraphContent) => {
    localStorage.setItem(graphContentKey(graphId), JSON.stringify(content))
  }

  const loadGraph = (graphId: string): GraphContent | null => {
    const storedContent = localStorage.getItem(graphContentKey(graphId))
    if (storedContent) {
      try {
        const content: GraphContent = JSON.parse(storedContent)
        graphContents.value.set(graphId, content)
        return content
      } catch (e) {
        console.error('Failed to load graph', e)
        return null
      }
    }
    return null
  }

  return {
    setPrefix,
    graphContents,
    currentGraphId,
    currentGraphElements,
    stateVersion,
    selectedElement,
    setSelectedElement,
    selectGraph,
    createNewGraphContent,
    updateGraphElements,
    updateGraphLayout,
    setGraphLanguage,
    setPendingLayout,
    takePendingLayout,
    updateGraphViewport,
    deleteGraphContent,
    saveGraph,
    loadGraph,
  }
})
