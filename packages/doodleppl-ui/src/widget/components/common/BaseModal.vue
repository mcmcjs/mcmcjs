<script setup lang="ts">
import Dialog from 'primevue/dialog'
import { computed, inject } from 'vue'

const props = defineProps<{
  isOpen: boolean
  header?: string
}>()

const emit = defineEmits(['close'])

// Render the dialog inside the overlay shadow root so host page CSS cannot reach
// it; PrimeVue's default appendTo="body" would portal it back into the page.
const overlayTarget = inject<HTMLElement | null>('doodlepplOverlayTarget', null)

const visible = computed({
  get: () => props.isOpen,
  set: (value) => {
    if (!value) emit('close')
  },
})
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="header"
    class="db-base-modal-responsive"
    dismissableMask
    :append-to="overlayTarget ?? 'body'"
  >
    <template #header v-if="$slots.header">
      <slot name="header"></slot>
    </template>

    <slot name="body"></slot>
    <slot></slot>

    <template #footer v-if="$slots.footer">
      <slot name="footer"></slot>
    </template>
  </Dialog>
</template>

<style>
/* Global styles for the PrimeVue Dialog class. 
  We use the specific class 'db-base-modal-responsive' to target only our modals.
*/
.db-base-modal-responsive {
  width: 50vw;
}

@media (max-width: 768px) {
  .db-base-modal-responsive {
    width: 95vw !important;
  }
}
</style>
