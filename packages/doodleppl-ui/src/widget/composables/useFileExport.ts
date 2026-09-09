import { ref } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useGraphStore } from '../stores/graphStore'
import { useGraphInstance } from './useGraphInstance'
import type { Artifact } from './useModelArtifacts'
import { downloadBlob } from '../utils/downloadBlob'

/**
 * Saving things to disk: pictures of the canvas, and whatever artifact a panel
 * hands over. The artifacts are derived in `useModelArtifacts`, so nothing is
 * generated or cached here.
 */
export function useFileExport() {
  const graphStore = useGraphStore()
  const toast = useToast()
  const { getCyInstance } = useGraphInstance()

  const showExportModal = ref(false)
  const currentExportType = ref<'png' | 'jpg' | 'svg' | null>(null)

  const downloadArtifact = (artifact: Artifact) => {
    if (!artifact.content) return
    downloadBlob(new Blob([artifact.content], { type: artifact.mime }), artifact.filename)
  }

  const openExportModal = (format: 'png' | 'jpg' | 'svg') => {
    currentExportType.value = format
    showExportModal.value = true
  }

  const handleConfirmExport = (options: {
    bg: string
    full: boolean
    scale: number
    quality?: number
  }) => {
    const cy = graphStore.currentGraphId ? getCyInstance(graphStore.currentGraphId) : null
    if (!cy || !currentExportType.value) return
    try {
      let blob: Blob
      const baseOptions = { bg: options.bg, full: options.full, scale: options.scale }
      if (currentExportType.value === 'svg') {
        blob = new Blob([cy.svg(baseOptions)], { type: 'image/svg+xml;charset=utf-8' })
      } else if (currentExportType.value === 'png') {
        blob = cy.png({ ...baseOptions, output: 'blob' }) as unknown as Blob
      } else {
        blob = cy.jpg({
          ...baseOptions,
          quality: options.quality || 0.9,
          output: 'blob',
        }) as unknown as Blob
      }
      downloadBlob(blob, `graph.${currentExportType.value}`)
    } catch (err) {
      console.error('Export failed', err)
      toast.add({
        severity: 'error',
        summary: 'Export Failed',
        detail: err instanceof Error ? err.message : 'Could not export the graph.',
        life: 3000,
      })
    }
  }

  return {
    showExportModal,
    currentExportType,
    downloadArtifact,
    openExportModal,
    handleConfirmExport,
  }
}
