import { NextRequest, NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/authz'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  ACTIVITY_LABELS,
  ENTITY_LABEL_LIST,
  affectedUserId,
  describeAudit,
  type AuditLookups,
} from '@/lib/audit-display'

export const dynamic = 'force-dynamic'

type DisplayEntry = {
  key: string
  activityType: string
  summary: string
  entity: { typeLabel: string; label: string }
  actor: { displayName: string; isSystem: boolean }
  affectsUser: boolean
  affectedUser: string | null
  occurredAt: string
  occurredAtLabel: string
  context: string[]
}

function dateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  try {
    return new Intl.DateTimeFormat('en-ZA', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

// GET /api/admin/audit — read-only, human-readable audit stream for administrators.
// Raw action codes, table names, UUIDs and JSON snapshots never leave this route.
export async function GET(req: NextRequest) {
  const denied = await requireAdministrator(req)
  if (denied) return denied

  try {
    const db = getSupabaseAdmin()
    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') || '').trim().toLowerCase()
    const userQuery = (searchParams.get('user') || '').trim().toLowerCase()
    const userScope = searchParams.get('userScope') || 'any'
    const activity = (searchParams.get('activity') || '').trim()
    const entityType = (searchParams.get('entityType') || '').trim()
    const from = (searchParams.get('from') || '').trim()
    const to = (searchParams.get('to') || '').trim()
    const requestedLimit = Number(searchParams.get('limit') || 100)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 300)
      : 100

    const [auditResult, profilesResult, projectsResult, clientsResult, documentsResult] = await Promise.all([
      db
        .from('audit_entries')
        .select('action, entity_type, entity_id, before_value, after_value, actor_user_id, created_at')
        .order('created_at', { ascending: false })
        .limit(1000),
      db.from('profiles').select('id, full_name, email'),
      db.from('projects').select('id, name, project_reference'),
      db.from('clients').select('id, name'),
      db.from('documents').select('id, title'),
    ])

    if (auditResult.error) {
      return NextResponse.json({ error: 'Could not load activity history.' }, { status: 500 })
    }

    const lookups: AuditLookups = {
      profiles: new Map(
        (profilesResult.data || []).map((row) => [
          row.id as string,
          { name: (row.full_name as string) || '', email: (row.email as string) || null },
        ]),
      ),
      projects: new Map(
        (projectsResult.data || []).map((row) => [
          row.id as string,
          (row.name as string) || (row.project_reference as string) || 'a project',
        ]),
      ),
      clients: new Map(
        (clientsResult.data || []).map((row) => [row.id as string, (row.name as string) || 'a client']),
      ),
      documents: new Map(
        (documentsResult.data || []).map((row) => [row.id as string, (row.title as string) || 'a document']),
      ),
    }

    const actorEmails = new Map<string, string>()
    for (const profile of profilesResult.data || []) {
      if (profile.email) actorEmails.set(profile.id as string, profile.email as string)
    }

    const described = (auditResult.data || []).map((row) => {
      const description = describeAudit(row, lookups)
      const actorId = (row.actor_user_id as string) || ''
      const actorProfile = actorId ? lookups.profiles.get(actorId) : undefined
      const actor = {
        displayName: actorProfile?.name || actorProfile?.email || (actorId ? 'a former user account' : 'System'),
        isSystem: !actorId,
      }
      const actorEmail = actorEmails.get(actorId) || ''
      // Affected users are matched by name or email too, but their email is
      // only a search input — the response never exposes internal identifiers.
      const affectedId = affectedUserId(row)
      const affectedEmail = affectedId ? (actorEmails.get(affectedId) || '') : ''
      return { row, description, actor, actorEmail, affectedEmail }
    })

    const matchesUser = (item: (typeof described)[number]) => {
      if (!userQuery) return true
      const actorMatch = [item.actor.displayName, item.actorEmail].join(' ').toLowerCase().includes(userQuery)
      const affectedMatch = [item.description.affectedUser, item.affectedEmail]
        .filter(Boolean).join(' ').toLowerCase().includes(userQuery)
      if (userScope === 'actor') return actorMatch
      if (userScope === 'affected') return affectedMatch
      return actorMatch || affectedMatch
    }

    const filtered = described.filter((item) => {
      const occurredAt = item.row.created_at as string
      if (from && occurredAt.slice(0, 10) < from) return false
      if (to && occurredAt.slice(0, 10) > to) return false
      if (activity && item.description.activityType !== activity) return false
      if (entityType && item.description.subjectType !== entityType) return false
      if (!matchesUser(item)) return false
      if (q) {
        const haystack = [
          item.description.activityType,
          item.description.summary,
          item.description.subject,
          item.description.subjectType,
          item.description.affectedUser,
          item.actor.displayName,
          ...item.description.context,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })

    const entries: DisplayEntry[] = filtered.slice(0, limit).map((item, index) => ({
      key: `entry-${index}`,
      activityType: item.description.activityType,
      summary: item.description.summary,
      entity: { typeLabel: item.description.subjectType, label: item.description.subject },
      actor: item.actor,
      affectsUser: item.description.affectsUser,
      affectedUser: item.description.affectedUser,
      occurredAt: item.row.created_at as string,
      occurredAtLabel: dateLabel(item.row.created_at as string),
      context: item.description.context,
    }))

    const facetUsers = Array.from(new Set(
      filtered.flatMap((item) => [item.actor.displayName, item.description.affectedUser])
        .filter((value): value is string => Boolean(value)),
    )).sort((a, b) => a.localeCompare(b))

    return NextResponse.json({
      entries,
      facets: {
        activityTypes: ACTIVITY_LABELS,
        entityTypes: ENTITY_LABEL_LIST,
        users: facetUsers,
      },
      total: filtered.length,
      limit,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    // Never expose database errors, query text or internal identifiers here.
    return NextResponse.json(
      { error: 'Could not load activity history.' },
      { status: 500 }
    )
  }
}
