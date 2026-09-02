/** Minimal Vite build surface used by this application.
 * Vite replaces these flags at build time; only the ones we read are declared.
 */
interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** CSS Modules. Vite resolves the real class names at build time; the compiler
 * only needs to know the default export is a string map. */
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
