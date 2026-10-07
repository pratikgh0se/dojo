/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "off" skips disk sync entirely (Dexie only) */
  readonly VITE_DOJO_DISK?: string
  /** 'fake' (default in dev and test) | 'helper' */
  readonly VITE_DOJO_AI?: string
  /** helper port on 127.0.0.1, default 8788 */
  readonly VITE_DOJO_AI_PORT?: string
  /** full helper base URL; wins over VITE_DOJO_AI_PORT (ladder contract §2.5) */
  readonly VITE_DOJO_HELPER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
