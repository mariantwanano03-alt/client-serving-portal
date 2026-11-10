import { connection } from 'next/server'
import DiscoveryClient from './DiscoveryClient'

export const instant = false

export default async function DiscoveryPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  return <DiscoveryClient id={id} />
}
