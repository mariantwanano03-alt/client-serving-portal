import { connection } from 'next/server'
import ProjectDetailClient from './ProjectDetailClient'

export const instant = false

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  return <ProjectDetailClient id={id} />
}
