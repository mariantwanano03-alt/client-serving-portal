'use client'

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react'

type ThemeMode = 'light' | 'dark' | 'system'

export type { ThemeMode }

interface ThemeContextValue {
  theme: ThemeMode
  resolvedTheme: 'light' | 'dark'
  setTheme: (mode: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const [theme, setThemeState] = useState<ThemeMode>('system')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')

  const storedTheme = useRef<ThemeMode | null>(null)

  // Load saved theme from localStorage on mount
  useEffect(() => {
    setMounted(true)
    const saved = localStorage.getItem('client-serving-portal-theme') as ThemeMode | null
    if (saved && ['light', 'dark', 'system'].includes(saved)) {
      setThemeState(saved)
      storedTheme.current = saved
    }
    applyTheme(saved || 'system')
  }, [])

  // Apply theme to document root
  const applyTheme = useCallback((mode: ThemeMode) => {
    if (typeof window === 'undefined') return

    let resolved: 'light' | 'dark'

    if (mode === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    } else {
      resolved = mode
    }

    const root = document.documentElement

    if (resolved === 'dark') {
      root.classList.add('dark')
      root.setAttribute('data-theme', 'dark')
    } else {
      root.classList.remove('dark')
      root.setAttribute('data-theme', 'light')
    }

    setResolvedTheme(resolved)
    storedTheme.current = mode
    localStorage.setItem('client-serving-portal-theme', mode)
  }, [])

  // Watch for system theme changes
  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handler = () => {
      if (theme === 'system') {
        applyTheme('system')
      }
    }

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [theme, applyTheme])

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode)
    applyTheme(mode)
  }, [applyTheme])

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeMode = prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light'
      applyTheme(next)
      return next
    })
  }, [applyTheme])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  return context
}
