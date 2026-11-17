'use client'

import PortalShell from '@/components/PortalShell'

export default function Settings() {
  return (
    <PortalShell title="Settings" breadcrumb="WORKSPACE / SETTINGS">
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#14213d', margin: '0 0 16px' }}>
          Settings
        </h1>
        <p style={{ fontSize: 15, color: '#64748b', margin: '0 0 32px' }}>
          Workspace settings coming soon.
        </p>
      </div>
    </PortalShell>
  )
}
