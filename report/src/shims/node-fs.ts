// @mcmcjs/core imports node builtins for its file-path helpers; the app only
// uses its text-level APIs, so the browser build stubs them out.
const unavailable = (): never => {
  throw new Error("file access is not available in the browser");
};

export const readFileSync = unavailable;
export const writeFileSync = unavailable;
export const mkdirSync = unavailable;
export const renameSync = unavailable;
export const rmdirSync = unavailable;
export const statSync = unavailable;
export const existsSync = (): boolean => false;
