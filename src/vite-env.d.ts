/// <reference types="vite/client" />

/** Injected by vite.config.ts at build time — see the comment there. */
declare const __BUILD_ID__: string;

declare module "*.svg" {
  const src: string;
  export default src;
}
