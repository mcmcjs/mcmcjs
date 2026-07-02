// The editor as a custom element. Loaded lazily by the DoodlePPL mount class so the
// heavy widget bundle (Vue, Cytoscape, PrimeVue) stays out of consumers' entry chunks.

import Aura from "@primevue/themes/aura";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import { defineCustomElement } from "vue";
import { WIDGET_TAG } from "./tag";
import DoodleWidget from "./widget/DoodleWidget.vue";

// Head-delivered styles for everything the widget teleports into the page (sidebars,
// panels, modals, PrimeVue overlays) plus the @font-face declarations, which browsers
// only honor at document level.
import "./widget/assets/styles/global.css";
import "primeicons/primeicons.css";

// The canvas subtree renders inside the element's shadow root, where head styles
// cannot reach: its SFC styles ride along via the customElement build (see
// vite.config.ts) and the primeicons class rules are re-injected here.
import primeiconsCss from "primeicons/primeicons.css?inline";

const widget = DoodleWidget as typeof DoodleWidget & { styles?: string[] };
widget.styles = [...(widget.styles ?? []), primeiconsCss];

export const DoodlePPLElement = defineCustomElement(widget, {
  shadowRoot: true,
  configureApp(app) {
    app.use(createPinia());
    app.use(PrimeVue, {
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: ".db-dark-mode",
        },
      },
    });
    app.use(ToastService);
  },
});

if (!customElements.get(WIDGET_TAG)) {
  customElements.define(WIDGET_TAG, DoodlePPLElement);
}
