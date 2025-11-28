/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STORY_UI_SERVER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
