<script setup lang="ts">
import { inject, ref } from 'vue'
import Popover from 'primevue/popover'

// The panel renders into the overlay shadow root, out of host CSS reach.
const overlayTarget = inject<HTMLElement | null>('doodlepplOverlayTarget', null)

const op = ref()

const toggle = (event: Event) => {
  // The popover's document-level dismiss listener reads event.target, which shadow
  // DOM retargets to the overlay host; keep the opening click from reaching it.
  event.stopPropagation()
  op.value.toggle(event)
}

const close = () => {
  op.value.hide()
}

const onContentClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (target.closest('input, select, textarea, label')) {
    return
  }
  close()
}
</script>

<template>
  <div class="inline-block">
    <div @click="toggle" class="cursor-pointer inline-block">
      <slot name="trigger"></slot>
    </div>
    <Popover ref="op" :append-to="overlayTarget ?? 'body'">
      <div class="flex flex-col min-w-[150px] py-1" @click="onContentClick">
        <slot name="content"></slot>
      </div>
    </Popover>
  </div>
</template>

<style>
.p-popover-content a {
  display: block;
  padding: 0.5rem 1rem;
  color: var(--p-text-color);
  text-decoration: none;
  transition: background-color 0.2s;
}
.p-popover-content a:hover {
  background-color: var(--p-content-hover-background);
}

.db-dropdown-divider {
  height: 1px;
  background-color: var(--p-content-border-color);
  margin: 0.25rem 0;
}

.db-dropdown-section-title {
  padding: 0.5rem 1rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
}
</style>
