import PortalShell from '@/components/PortalShell'
import ProjectWorkspace from './ProjectWorkspace'

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const { id } = await params
  const { tab } = await searchParams

  return (
    <PortalShell title="Project Workspace" breadcrumb="WORKSPACE / PROJECTS / WORKSPACE">
      <ProjectWorkspace id={id} initialTab={typeof tab === 'string' ? tab : undefined} />
    </PortalShell>
  )
}
