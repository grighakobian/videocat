import type { GrabbitApi } from './index'

declare global {
  interface Window {
    grabbit: GrabbitApi
  }
}

export {}
