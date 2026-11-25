'use client'

import React, { useState, useEffect } from 'react'
import { debugService, DebugEvent } from '@/debug/debugService'

// Side debug panel that appears when editing client
const DebugPanel = ({ isOpen, onClose }: { isOpen?: boolean; onClose?: () => void }) => {
  const actualIsOpen = isOpen === true // Only visible when explicitly opened
  const [category, setCategory] = useState('ALL')
  const [events, setEvents] = useState<DebugEvent[]>([])

  useEffect(() => {
    // Subscribe to debug events from the service
    const unsubscribe = debugService.on((event: DebugEvent) => {
      setEvents(prev => [...prev, event].slice(-100)) // Keep last 100 events
    })

    return () => {
      unsubscribe()
    }
  }, [category])

  // Panel transition settings
  const panelWidth = actualIsOpen ? '400px' : '0'
  const panelOpacity = actualIsOpen ? 1 : 0
  const pointerEvents = actualIsOpen ? 'auto' : 'none'

  return (
    <div style={{
      position: 'fixed',
      zIndex: 9999,
      width: '100%',
      maxWidth: '400px',
      height: 'calc(100vh - 40px)',
      bottom: 0,
      right: actualIsOpen ? '0' : '-400px', // Slide in from right
      top: 0,
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      boxShadow: '-4px 0 12px rgba(0,0,0,0.15)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      opacity: panelOpacity,
      pointerEvents: pointerEvents,
    }}>
      {/* Close button */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '8px',
      }}>
        <button
          onClick={onClose}
          style={{
            padding: '4px 8px',
            background: 'transparent',
            border: 'none',
            color: 'var(--muted)',
            fontSize: '14px',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          ✕ Close
        </button>
      </div>

      {/* Header */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--accent)',
        color: 'var(--accent-contrast)',
        fontSize: '12px',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span>🐛 Debug</span>
        <span>Client Edit</span>
      </div>

      {/* Events list */}
      <div style={{ flex: 1, padding: '12px', overflowY: 'auto' }}>
        <p style={{ color: 'var(--muted)', fontSize: '11px' }}>
          Debug Events<br />
          {events.length} events
        </p>

        {events.length > 0 && (
          <div style={{ height: '200px', overflowY: 'auto', padding: '4px' }}>
            {events.map((event) => (
              <div
                key={event.id}
                style={{
                  borderBottom: '1px solid var(--border)',
                  padding: '4px 0',
                  fontSize: '10px',
                  color: 'var(--text)',
                }}
              >
                <div style={{ fontWeight: 500, color: 'var(--heading)' }}>
                  {event.title}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: '9px' }}>
                  {event.timestampFormatted} | {event.category}
                </div>
              </div>
            ))}
          </div>
        )}

        {events.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: '11px' }}>
            No events yet.
          </p>
        )}
      </div>
    </div>
  )
}

export default DebugPanel