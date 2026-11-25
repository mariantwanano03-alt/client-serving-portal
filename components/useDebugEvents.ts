/**
 * Debugging Event Logger Hook
 * A reusable set of helpers to track input changes, button clicks, form
 * submissions, navigation, etc.
 *
 * IMPORTANT: these are plain functions, not Hooks. The previous implementation
 * called `useCallback` inside another `useCallback`, which is against the Rules
 * of Hooks. It threw "Invalid hook call" on every keystroke and broke typing
 * in the client edit form. Hooks must never be called from event handlers.
 */

import { DebugEventType, DebugEventSeverity, DebugEventCategory, debugService } from '@/debug/debugService'

export interface UseDebugEventsReturn {
  logInputChange: (pageId: string, componentId: string, fieldName: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  logSelectChange: (pageId: string, componentId: string, fieldName: string) => (e: React.ChangeEvent<HTMLSelectElement>) => void
  logButtonClick: (pageId: string, componentId: string, action: string) => () => void
  logFormSubmit: (pageId: string, componentId: string, formName: string) => (e: React.FormEvent) => void
  logFormValidation: (pageId: string, componentId: string, formName: string, isValid: boolean, errors?: string[]) => void
  logNavigation: (pageId: string, componentId: string, from: string, to: string) => void
  logModal: (pageId: string, componentId: string, action: 'open' | 'close', modalName?: string) => void
  logApiRequest: (pageId: string, componentId: string, endpoint: string, method: string) => (e: React.FormEvent) => void
  logApiResponse: (pageId: string, componentId: string, endpoint: string, success?: boolean) => void
  logApiError: (pageId: string, componentId: string, endpoint: string) => void
  logDatabaseOperation: (pageId: string, componentId: string, operation: 'insert' | 'update' | 'delete', table: string) => void
  logError: (pageId: string, componentId: string, error: Error, context: string) => void
  logSettingChange: (pageId: string, componentId: string, setting: string, value: string | number | boolean | unknown) => void
  logCreateProject: (pageId: string, componentId: string, projectName: string, clientName?: string) => void
  logClientAction: (pageId: string, componentId: string, action: 'create' | 'edit' | 'delete' | 'select', clientName?: string) => void
  logDocumentAction: (pageId: string, componentId: string, action: 'upload' | 'download' | 'delete', fileName?: string) => void
}

export function useDebugEvents(): UseDebugEventsReturn {
  return {
    logInputChange: (pageId, componentId, fieldName) => (e) => {
      const target = e.target
      let value = ''
      if (target.type === 'checkbox' || target.type === 'radio') {
        value = String((target as HTMLInputElement).checked)
      } else {
        value = (target as HTMLInputElement | HTMLTextAreaElement).value
      }
      debugService.log({
        category: DebugEventCategory.INPUT_CHANGES,
        type: DebugEventType.INPUT_CHANGE,
        page: pageId,
        component: componentId,
        title: `Input: ${fieldName}`,
        description: `${fieldName}: "${value}"`,
        severity: DebugEventSeverity.INFO,
        success: true,
      })
    },

    logSelectChange: (pageId, componentId, fieldName) => (e) => {
      debugService.log({
        category: DebugEventCategory.INPUT_CHANGES,
        type: DebugEventType.INPUT_CHANGE,
        page: pageId,
        component: componentId,
        title: `Selection: ${fieldName}`,
        description: `${fieldName} changed to: "${e.target.value}"`,
        severity: DebugEventSeverity.INFO,
        success: true,
      })
    },

    logButtonClick: (pageId, componentId, action) => () => {
      debugService.log({
        category: DebugEventCategory.BUTTON_CLICKS,
        type: DebugEventType.BUTTON_CLICK,
        page: pageId,
        component: componentId,
        title: `Button Click: ${action}`,
        description: action,
        severity: DebugEventSeverity.INFO,
        success: true,
      })
    },

    logFormSubmit: (pageId, componentId, formName) => () => {
      debugService.log({
        category: DebugEventCategory.USER_INTERACTIONS,
        type: DebugEventType.FORM_SUBMIT,
        page: pageId,
        component: componentId,
        title: `Form Submit: ${formName}`,
        description: `${formName} submitted`,
        severity: DebugEventSeverity.INFO,
        success: true,
      })
    },

    logFormValidation: (pageId, componentId, formName, isValid, errors) => {
      debugService.log({
        category: DebugEventCategory.VALIDATION,
        type: DebugEventType.FORM_VALIDATION,
        page: pageId,
        component: componentId,
        title: `Form Validation: ${formName}`,
        description: isValid ? 'Validation passed' : (errors?.join(', ') || 'unknown error'),
        severity: isValid ? DebugEventSeverity.SUCCESS : DebugEventSeverity.WARNING,
        success: isValid,
        previousState: isValid ? undefined : { errors },
      })
    },

    logNavigation: (pageId, componentId, from, to) => {
      debugService.log({
        category: DebugEventCategory.NAVIGATION,
        type: DebugEventType.NAVIGATION,
        page: pageId,
        component: componentId,
        title: `Navigation: ${from} → ${to}`,
        description: `Navigated: ${from} → ${to}`,
        severity: DebugEventSeverity.INFO,
        success: true,
      })
    },

    logModal: (pageId, componentId, action, modalName) => {
      debugService.log({
        category: DebugEventCategory.SYSTEM_EVENTS,
        type: action === 'open' ? DebugEventType.MODAL_OPEN : DebugEventType.MODAL_CLOSE,
        page: pageId,
        component: componentId,
        title: `Modal: ${action.toUpperCase()}`,
        description: modalName || action,
        severity: DebugEventSeverity.INFO,
        success: true,
      })
    },

    logApiRequest: (pageId, componentId, endpoint, method) => () => {
      debugService.log({
        category: DebugEventCategory.API_REQUESTS,
        type: DebugEventType.API_REQUEST,
        page: pageId,
        component: componentId,
        title: `API Request: ${method} ${endpoint}`,
        description: `${method} ${endpoint}`,
        severity: DebugEventSeverity.INFO,
        success: true,
        requestDetails: { method, endpoint },
      })
    },

    logApiResponse: (pageId, componentId, endpoint, success) => {
      debugService.log({
        category: DebugEventCategory.API_RESPONSES,
        type: DebugEventType.API_RESPONSE,
        page: pageId,
        component: componentId,
        title: `API Response: ${endpoint}`,
        description: success === undefined ? 'Response received' : (success ? 'Response received successfully' : 'Response received with errors'),
        severity: success === false ? DebugEventSeverity.ERROR : DebugEventSeverity.SUCCESS,
        success: success !== false,
        responseDetails: { status: success === false ? 0 : 200, statusText: success === false ? 'Error' : 'OK' },
      })
    },

    logApiError: (pageId, componentId, endpoint) => {
      debugService.log({
        category: DebugEventCategory.API_REQUESTS,
        type: DebugEventType.API_ERROR,
        page: pageId,
        component: componentId,
        title: `API Error: ${endpoint}`,
        description: 'Request failed',
        severity: DebugEventSeverity.ERROR,
        success: false,
        errorMessage: 'Request failed',
        requestDetails: { method: 'Unknown', endpoint },
      })
    },

    logDatabaseOperation: (pageId, componentId, operation, table) => {
      debugService.log({
        category: DebugEventCategory.DATABASE_OPERATIONS,
        type: DebugEventType.DATABASE_INSERT,
        page: pageId,
        component: componentId,
        title: `Database ${operation.toUpperCase()}: ${table}`,
        description: `${operation} operation on ${table}`,
        severity: DebugEventSeverity.INFO,
        success: true,
      })
    },

    logError: (pageId, componentId, error, context) => {
      debugService.log({
        category: DebugEventCategory.ERRORS,
        type: DebugEventType.ERROR_RUNTIME,
        page: pageId,
        component: componentId,
        title: `Runtime Error: ${context}`,
        description: error.message || 'Unknown error',
        severity: DebugEventSeverity.ERROR,
        success: false,
        errorMessage: error.message,
      })
    },

    logSettingChange: (pageId, componentId, setting, value) => {
      const valueStr = value === null || value === undefined ? 'null' : String(value)
      debugService.log({
        category: DebugEventCategory.SYSTEM_EVENTS,
        type: DebugEventType.SETTING_CHANGE,
        page: pageId,
        component: componentId,
        title: `Setting Change: ${setting}`,
        description: `${setting}: ${valueStr.substring(0, 100)}${valueStr.length > 100 ? '...' : ''}`,
        severity: DebugEventSeverity.INFO,
        success: true,
        newState: { [setting]: value },
      })
    },

    logCreateProject: (pageId, componentId, projectName, clientName) => {
      debugService.log({
        category: DebugEventCategory.USER_INTERACTIONS,
        type: DebugEventType.CREATE_PROJECT,
        page: pageId,
        component: componentId,
        title: 'Create Project',
        description: `Project created: "${projectName}"${clientName ? ` for client: "${clientName}"` : ''}`,
        severity: DebugEventSeverity.SUCCESS,
        success: true,
        newState: { projectName, clientName },
      })
    },

    logClientAction: (pageId, componentId, action, clientName) => {
      const labels = { create: 'Create Client', edit: 'Edit Client', delete: 'Delete Client', select: 'Select Client' }
      debugService.log({
        category: DebugEventCategory.USER_INTERACTIONS,
        type: DebugEventType.EDIT_CLIENT,
        page: pageId,
        component: componentId,
        title: labels[action],
        description: `${labels[action]}: ${clientName || '—'}`,
        severity: action === 'delete' ? DebugEventSeverity.WARNING : DebugEventSeverity.INFO,
        success: action !== 'delete',
      })
    },

    logDocumentAction: (pageId, componentId, action, fileName) => {
      const labels = { upload: 'Upload Document', download: 'Download Document', delete: 'Delete Document' }
      debugService.log({
        category: DebugEventCategory.USER_INTERACTIONS,
        type: DebugEventType.UPLOAD_DOCUMENT,
        page: pageId,
        component: componentId,
        title: labels[action],
        description: `${labels[action]}: ${fileName || '—'}`,
        severity: action === 'delete' ? DebugEventSeverity.WARNING : DebugEventSeverity.INFO,
        success: action !== 'delete',
      })
    },
  }
}
