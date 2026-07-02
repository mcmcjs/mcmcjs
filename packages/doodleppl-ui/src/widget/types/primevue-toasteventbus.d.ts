// PrimeVue ships primevue/toasteventbus without type declarations.
declare module 'primevue/toasteventbus' {
  interface ToastEventBus {
    // biome-ignore lint/suspicious/noExplicitAny: the bus carries PrimeVue's untyped toast payloads
    on(type: string, handler: (payload: any) => void): void
    // biome-ignore lint/suspicious/noExplicitAny: matches on()
    off(type: string, handler: (payload: any) => void): void
    emit(type: string, payload?: unknown): void
  }
  const bus: ToastEventBus
  export default bus
}
