// The single-file CDN build: the editor is bundled eagerly and the mount class is
// exposed as a global, so a page needs one script tag and `new DoodlePPL({ ... })`.
import { DoodlePPL } from "./index";
import "./element";

(globalThis as Record<string, unknown>).DoodlePPL = DoodlePPL;
