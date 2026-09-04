import type { VideoCatApi } from './index'

declare global {
  interface Window {
    videocat: VideoCatApi
  }
}

export {}
