import { connection } from 'next/server'
import ClientDetailClient from './ClientDetailClient'

export const instant = false

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  return <ClientDetailClient id={id} />
}
