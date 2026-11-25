import PortalShell from '@/components/PortalShell'
import ClientDetail from './ClientDetail'

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <PortalShell title="Client Profile" breadcrumb="WORKSPACE / CLIENTS / PROFILE">
      <ClientDetail id={id} />
    </PortalShell>
  )
}
