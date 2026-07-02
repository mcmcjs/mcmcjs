// The editor as a custom element. Loaded lazily by the DoodlePPL mount class so the
// heavy widget bundle (Vue, Cytoscape, PrimeVue) stays out of consumers' entry chunks.

import Aura from "@primevue/themes/aura";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import { defineCustomElement } from "vue";
import { WIDGET_TAG } from "./tag";
import DoodleWidget from "./widget/DoodleWidget.vue";

import "./widget/assets/styles/global.css";
import "primeicons/primeicons.css";

export const DoodlePPLElement = defineCustomElement(DoodleWidget, {
  shadowRoot: false,
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
