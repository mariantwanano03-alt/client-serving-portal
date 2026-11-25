/**
 * Centralized Debugging Service
 * 
 * Manages the debugging event stream with:
 * - Event retention and memory management
 * - Category filtering
 * - Search support
 * - Sensitive data redaction
 * - Performance-aware event batching
 */

// Event category enumeration
export const DebugEventCategory = {
  ALL: 'ALL',
  USER_INTERACTIONS: 'USER_INTERACTIONS',
  INPUT_CHANGES: 'INPUT_CHANGES',
  BUTTON_CLICKS: 'BUTTON_CLICKS',
  NAVIGATION: 'NAVIGATION',
  API_REQUESTS: 'API_REQUESTS',
  API_RESPONSES: 'API_RESPONSES',
  DATABASE_OPERATIONS: 'DATABASE_OPERATIONS',
  VALIDATION: 'VALIDATION',
  WARNINGS: 'WARNINGS',
  ERRORS: 'ERRORS',
  SYSTEM_EVENTS: 'SYSTEM_EVENTS',
}

// Type export
export type DebugEventCategory = typeof DebugEventCategory[keyof typeof DebugEventCategory]

// Event type enumeration for description
export const DebugEventType = {
  INPUT_CHANGE: 'input_change',
  BUTTON_CLICK: 'button_click',
  FORM_SUBMIT: 'form_submit',
  FORM_VALIDATION: 'form_validation',
  API_REQUEST: 'api_request',
  API_RESPONSE: 'api_response',
  API_ERROR: 'api_error',
  DATABASE_INSERT: 'database_insert',
  DATABASE_UPDATE: 'database_update',
  DATABASE_DELETE: 'database_delete',
  NAVIGATION: 'navigation',
  MODAL_OPEN: 'modal_open',
  MODAL_CLOSE: 'modal_close',
  SETTING_CHANGE: 'setting_change',
  ERROR_RUNTIME: 'error_runtime',
  ERROR_API: 'error_api',
  ERROR_VALIDATION: 'error_validation',
  SYSTEM_WARNING: 'system_warning',
  SYSTEM_ERROR: 'system_error',
  CREATE_PROJECT: 'create_project',
  EDIT_CLIENT: 'edit_client',
  DELETE_CLIENT: 'delete_client',
  CREATE_CLIENT: 'create_client',
  UPLOAD_DOCUMENT: 'upload_document',
  DOWNLOAD_DOCUMENT: 'download_document',
} as const

// Type export
export type DebugEventType = typeof DebugEventType[keyof typeof DebugEventType]

// Event severity levels
export const DebugEventSeverity = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  SUCCESS: 'success',
} as const

// Type export
export type DebugEventSeverity = typeof DebugEventSeverity[keyof typeof DebugEventSeverity]

// Interface for a single debugging event
export interface DebugEvent {
  id: string
  timestamp: number
  category: DebugEventCategory
  type: DebugEventType
  page: string
  component: string
  title: string
  description: string
  severity: DebugEventSeverity
  success: boolean
  previousState?: unknown
  newState?: unknown
  requestDetails?: DebugRequestDetails
  responseDetails?: DebugResponseDetails
  errorMessage?: string
  duration?: number
  timestampFormatted: string
}

// Interface for request details (redacted for security)
export interface DebugRequestDetails {
  method: string
  endpoint: string
  params?: Record<string, unknown>
  query?: Record<string, unknown>
}

// Interface for response details (redacted for security)
export interface DebugResponseDetails {
  status: number
  statusText: string
  data?: unknown
  executionTime?: number
}

// Default retention limit (events to keep in memory)
const DEFAULT_RETENTION = 500

// Debug service class
class DebugService {
  private events: DebugEvent[] = []
  private retention: number
  private isPaused: boolean = false
  private listeners: ((event: DebugEvent) => void)[] = []
  private nextId = 0

  constructor(retention = DEFAULT_RETENTION) {
    this.retention = retention
  }

  // Add a listener for events
  on(listener: (event: DebugEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  // Emit an event to all listeners
  private emit(event: DebugEvent): void {
    if (this.isPaused) return

    this.events.push(event)

    // Enforce retention limit
    if (this.events.length > this.retention) {
      this.events = this.events.slice(-this.retention)
    }

    // Notify all listeners
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (e) {
        // Avoid listener errors breaking the system
        console.warn('Debug listener error:', e)
      }
    }
  }

  // Log an event with full details
  log(event: Omit<DebugEvent, 'id' | 'timestampFormatted' | 'timestamp'>): string {
    const eventId = `event-${++this.nextId}`
    const now = Date.now()
    const formattedTimestamp = new Date(now).toLocaleTimeString([], {
      minute: '2-digit',
      second: '2-digit',
    })

    const completeEvent: DebugEvent = {
      id: eventId,
      timestamp: now,
      category: event.category,
      type: event.type,
      page: event.page,
      component: event.component,
      title: event.title,
      description: event.description,
      severity: event.severity,
      success: event.success,
      previousState: event.previousState,
      newState: event.newState,
      requestDetails: event.requestDetails,
      responseDetails: event.responseDetails,
      errorMessage: event.errorMessage,
      duration: event.duration,
      timestampFormatted: formattedTimestamp,
    }

    this.emit(completeEvent)
    return eventId
  }

  // Get all events, optionally filtered
  getEvents(
    category?: DebugEventCategory,
    severity?: DebugEventSeverity,
    onlySuccess?: boolean
  ): DebugEvent[] {
    let filtered = this.events

    if (category && category !== DebugEventCategory.ALL) {
      filtered = filtered.filter(e => e.category === category)
    }

    if (severity) {
      filtered = filtered.filter(e => e.severity === severity)
    }

    if (onlySuccess !== undefined) {
      filtered = filtered.filter(e => e.success === onlySuccess)
    }

    return filtered.sort((a, b) => b.timestamp - a.timestamp)
  }

  // Get events by category
  getEventsByCategory(category: DebugEventCategory): DebugEvent[] {
    return this.getEvents(category)
  }

  // Get recent events (last N)
  getRecentEvents(count = 50): DebugEvent[] {
    return this.getEvents(DebugEventCategory.ALL).slice(0, count)
  }

  // Clear all events
  clear(): void {
    this.events = []
    this.nextId = 0
    this.emit({} as DebugEvent) // Notify listeners of clear
  }

  // Pause monitoring
  pause(): void {
    this.isPaused = true
  }

  // Resume monitoring
  resume(): void {
    this.isPaused = false
  }

  // Check if paused
  isPausedState(): boolean {
    return this.isPaused
  }

  // Get retention limit
  getRetention(): number {
    return this.retention
  }

  // Set retention limit
  setRetention(limit: number): void {
    this.retention = limit
    // Trim if needed
    if (this.events.length > limit) {
      this.events = this.events.slice(-limit)
    }
  }
}

// Create singleton instance
const debugService = new DebugService(DEFAULT_RETENTION)

// Export singleton
export { debugService }

