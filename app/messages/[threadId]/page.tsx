import ConversationView from './ConversationView'

// Server wrapper: resolve the dynamic segment and pass it to the client view.
export default async function MessageThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>
}) {
  const { threadId } = await params
  return <ConversationView threadId={threadId} />
}
