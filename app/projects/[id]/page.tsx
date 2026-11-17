import ProjectWorkspace from './ProjectWorkspace'

export const instant = false

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProjectWorkspace id={id} />
}
