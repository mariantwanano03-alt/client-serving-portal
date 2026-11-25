// TypeScript declaration for debug service on Window
// This allows the DebugPanel to access window.__debugService

interface DebugEvent {
  id: string
  timestamp: number
  category: string
  type: string
  page: string
  component: string
  title: string
  description: string
  severity: string
  success: boolean
  previousState?: unknown
  newState?: unknown
  requestDetails?: any
  responseDetails?: any
  errorMessage?: string
  duration?: number
  timestampFormatted: string
}

interface DebugService {
  on: (callback: (event: DebugEvent) => void) => () => void
  clear: () => void
  getEventsByCategory: (category: string) => any[]
}

declare global {
  interface Window {
    __debugService: DebugService | undefined
  }
}

export {}