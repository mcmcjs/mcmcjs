// `.tpl` templates are inlined as strings at build time (esbuild `text` loader).
declare module "*.tpl" {
  const content: string;
  export default content;
}
