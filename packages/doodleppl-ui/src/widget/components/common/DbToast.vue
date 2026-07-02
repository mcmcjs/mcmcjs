<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import ToastEventBus from 'primevue/toasteventbus'

// In-shadow display for PrimeVue's toast service. PrimeVue's own Toast component
// always portals to document.body (it has no appendTo prop in 4.5.5), which puts
// toasts back in reach of host page CSS; this renders the same ToastEventBus
// messages inside the overlay shadow root instead.
interface ToastMessage {
  severity?: 'success' | 'info' | 'warn' | 'error' | 'secondary' | 'contrast'
  summary?: string
  detail?: string
  life?: number
  group?: string
}

interface ActiveToast extends ToastMessage {
  id: number
}

let nextId = 0
const toasts = ref<ActiveToast[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()

const dismiss = (id: number) => {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

const onAdd = (message: ToastMessage) => {
  const toast: ActiveToast = { ...message, id: nextId++ }
  toasts.value = [...toasts.value, toast]
  if (toast.life) {
    timers.set(
      toast.id,
      setTimeout(() => dismiss(toast.id), toast.life)
    )
  }
}

const onRemoveAll = () => {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  toasts.value = []
}

onMounted(() => {
  ToastEventBus.on('add', onAdd)
  ToastEventBus.on('remove-all-groups', onRemoveAll)
})

onUnmounted(() => {
  ToastEventBus.off('add', onAdd)
  ToastEventBus.off('remove-all-groups', onRemoveAll)
  onRemoveAll()
})
</script>

<template>
  <div class="db-toast-stack">
    <TransitionGroup name="db-toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="db-toast-message"
        :class="`db-toast-${toast.severity || 'info'}`"
      >
        <div class="db-toast-text">
          <span v-if="toast.summary" class="db-toast-summary">{{ toast.summary }}</span>
          <span v-if="toast.detail" class="db-toast-detail">{{ toast.detail }}</span>
        </div>
        <button class="db-toast-close" @click="dismiss(toast.id)" aria-label="Close">
          <i class="pi pi-times"></i>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.db-toast-stack {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000011;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(320px, calc(100vw - 40px));
  pointer-events: none;
}

.db-toast-message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  pointer-events: auto;
  font-size: 12px;
  line-height: 1.5;
}

.db-toast-info {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #2563eb;
}

.db-toast-success {
  background: #ecfdf5;
  border-color: #a7f3d0;
  color: #059669;
}

.db-toast-warn {
  background: #fffbeb;
  border-color: #fde68a;
  color: #b45309;
}

.db-toast-error,
.db-toast-secondary,
.db-toast-contrast {
  background: #fef2f2;
  border-color: #fecaca;
  color: #dc2626;
}

.db-toast-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.db-toast-summary {
  font-weight: 600;
}

.db-toast-detail {
  color: var(--theme-text-secondary, #4b5563);
}

.db-toast-close {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1;
}

.db-toast-close:hover {
  background: rgba(0, 0, 0, 0.06);
}

:global(.db-dark-mode) .db-toast-info {
  background: #172554;
  border-color: #1e40af;
  color: #93c5fd;
}

:global(.db-dark-mode) .db-toast-success {
  background: #064e3b;
  border-color: #047857;
  color: #6ee7b7;
}

:global(.db-dark-mode) .db-toast-warn {
  background: #451a03;
  border-color: #b45309;
  color: #fcd34d;
}

:global(.db-dark-mode) .db-toast-error,
:global(.db-dark-mode) .db-toast-secondary,
:global(.db-dark-mode) .db-toast-contrast {
  background: #450a0a;
  border-color: #b91c1c;
  color: #fca5a5;
}

.db-toast-enter-active,
.db-toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.db-toast-enter-from,
.db-toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
