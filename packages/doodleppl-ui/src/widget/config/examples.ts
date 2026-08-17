import type { UnifiedModelData } from '@mcmcjs/doodleppl'

export interface ExampleModelConfig {
  id: string
  name: string
  load: () => Promise<UnifiedModelData>
}

// Bundled portable model documents; the npm build splits each into its own
// lazily loaded chunk, the CDN build inlines them.
const modules = import.meta.glob('./examples/*.json', { import: 'default' })

const example = (id: string, name: string): ExampleModelConfig => ({
  id,
  name,
  load: () => modules[`./examples/${id}.json`]() as Promise<UnifiedModelData>,
})

export const examples: ExampleModelConfig[] = [
  example('mixture', 'Mixture Model'),
  example('mixed-dag', 'Mixed Discrete DAG'),
  example('rats', 'Rats Model'),
  example('pumps', 'Pumps Model'),
  example('seeds', 'Seeds Model'),
  example('surgical', 'Surgical Model'),
  example('dyes', 'Dyes Model'),
  example('blockers', 'Blockers Model'),
  example('salm', 'Salm Model'),
  example('equiv', 'Equiv Model'),
  example('oxford', 'Oxford Model'),
  example('epil', 'Epilepsy Model'),
  example('mice', 'Mice Model'),
  example('kidney', 'Kidney Model'),
]

// Helper to check if a string is a URL
export const isUrl = (str: string) => {
  try {
    new URL(str)
    return true
  } catch {
    return false
  }
}
