'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Project = {
  id: string
  project_reference: string
  name: string
  description: string | null
  stage: string
  status: string
  clients: { client_code: string; name: string } | null
}

type Discovery = { id: string; meeting_date: string | null; summary: string | null; notes: string | null }
type Requirement = { id: string; requirement_ref: string; title: string; priority: string | null; status: string }
type DevLink = { id: string; link_type: string | null; url: string; verified: boolean }

export default function ProjectDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const [role, setRole] = useState('')
  const [userId, setUserId] = useState('')
  const [project, setProject] = useState<Project | null>(null)
  const [discoveries, setDiscoveries] = useState<Discovery[]>([])
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [devLinks, setDevLinks] = useState<DevLink[]>([])
  const [message, setMessage] = useState('Loading...')

  const [discDate, setDiscDate] = useState('')
  const [discSummary, setDiscSummary] = useState('')
  const [discNotes, setDiscNotes] = useState('')
  const [reqRef, setReqRef] = useState('')
  const [reqTitle, setReqTitle] = useState('')
  const [reqPriority, setReqPriority] = useState('medium')
  const [linkType, setLinkType] = useState('repository')
  const [linkUrl, setLinkUrl] = useState('')

  async function load() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push('/login'); return }
    setUserId(userData.user.id)
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userData.user.id).single()
    setRole(profile?.role ?? '')

    const { data: proj } = await supabase
      .from('projects')
      .select('id, project_reference, name, description, stage, status, clients(client_code, name)')
      .eq('id', id)
      .single()
    setProject(proj as unknown as Project)

    const { data: d } = await supabase.from('discovery_records').select('id, meeting_date, summary, notes').eq('project_id', id).order('created_at', { ascending: false })
    setDiscoveries((d ?? []) as Discovery[])

    const { data: r } = await supabase.from('requirements').select('id, requirement_ref, title, priority, status').eq('project_id', id).order('created_at', { ascending: false })
    setRequirements((r ?? []) as Requirement[])

    const { data: l } = await supabase.from('development_links').select('id, link_type, url, verified').eq('project_id', id).order('recorded_at', { ascending: false })
    setDevLinks((l ?? []) as DevLink[])

    setMessage('')
  }

  useEffect(() => { if (id) load() }, [id, router])

  async function addDiscovery() {
    if (!discSummary.trim() && !discNotes.trim()) {
      setMessage('Summary or notes is required to add a discovery record.')
      return
    }
    setMessage('Saving discovery...')
    const { error } = await supabase.from('discovery_records').insert({
      project_id: id,
      meeting_date: discDate || null,
      summary: discSummary.trim() || null,
      notes: discNotes.trim() || null,
      created_by: userId,
    })
    if (error) { setMessage('Could not save: ' + error.message); return }
    setDiscDate(''); setDiscSummary(''); setDiscNotes('')
    setMessage('Discovery saved.')
    await load()
  }

  async function addRequirement() {
    if (!reqRef || !reqTitle) { setMessage('Reference and title required.'); return }
    setMessage('Saving requirement...')
    const { error } = await supabase.from('requirements').insert({
      project_id: id,
      requirement_ref: reqRef,
      title: reqTitle,
      priority: reqPriority,
      created_by: userId,
    })
    if (error) { setMessage('Could not save: ' + error.message); return }
    setReqRef(''); setReqTitle('')
    setMessage('Requirement saved.')
    await load()
  }

  async function addDevLink() {
    if (!linkUrl) { setMessage('URL required.'); return }
    setMessage('Saving link...')
    const { error } = await supabase.from('development_links').insert({
      project_id: id,
      link_type: linkType,
      url: linkUrl,
      recorded_by: userId,
    })
    if (error) { setMessage('Could not save: ' + error.message); return }
    setLinkUrl('')
    setMessage('Development link recorded.')
    await load()
  }

  async function deleteDiscovery(discId: string) {
    if (!window.confirm('Delete this discovery record?')) return
    const { error } = await supabase.from('discovery_records').delete().eq('id', discId)
    if (error) { setMessage('Could not delete: ' + error.message); return }
    setMessage('Discovery record deleted.')
    await load()
  }

  async function verifyLink(linkId: string) {
    const { error } = await supabase.from('development_links').update({
      verified: true,
      verified_by: userId,
      verified_at: new Date().toISOString(),
    }).eq('id', linkId)
    if (error) { setMessage('Could not verify: ' + error.message); return }
    setMessage('Link verified.')
    await load()
  }

  const box = { padding: 8, color: 'black' }
  const canEdit = role === 'senior_dev_pm'

  if (!project) return <main style={{ padding: 40 }}>{message || 'Loading...'}</main>

  return (
    <main style={{ padding: 40, maxWidth: 900 }}>
      <button onClick={() => router.push('/projects')} style={{ marginBottom: 20 }}>← Back to projects</button>
      <h1>{project.project_reference} — {project.name}</h1>
      <p>Client: {project.clients?.name ?? 'unknown'} ({project.clients?.client_code})</p>
      <p>Stage: {project.stage} · Status: {project.status}</p>
      {project.description && <p>{project.description}</p>}
      <p>Your role: {role}</p>
      <p style={{ color: 'green' }}>{message}</p>

      <section style={{ marginTop: 30 }}>
        <h2>Discovery records</h2>
        {discoveries.length === 0 ? <p style={{ color: '#777', fontStyle: 'italic' }}>No discovery records yet. Add one below.</p> : (
          <ul>{discoveries.map((d) => (
            <li key={d.id} style={{ marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <strong>{d.meeting_date ?? 'No date'}</strong> — {d.summary}
                {d.notes && <div style={{ fontSize: 12, color: '#555' }}>{d.notes}</div>}
              </div>
              {canEdit && (
                <button onClick={() => deleteDiscovery(d.id)} title="Delete" style={{ padding: '2px 8px', color: 'red', border: '1px solid red', background: 'transparent', cursor: 'pointer' }}>
                  🗑
                </button>
              )}
            </li>
          ))}</ul>
        )}
        {canEdit && (
          <div style={{ display: 'grid', gap: 8, marginTop: 10, maxWidth: 500 }}>
            <input type="date" value={discDate} onChange={(e) => setDiscDate(e.target.value)} style={box} />
            <input placeholder="Summary" value={discSummary} onChange={(e) => setDiscSummary(e.target.value)} style={box} />
            <textarea placeholder="Notes" value={discNotes} onChange={(e) => setDiscNotes(e.target.value)} style={{ ...box, minHeight: 60 }} />
            <button onClick={addDiscovery} style={{ padding: 8 }}>Add discovery record</button>
          </div>
        )}
      </section>

      <section style={{ marginTop: 30 }}>
        <h2>Requirements</h2>
        {requirements.length === 0 ? <p style={{ color: '#777', fontStyle: 'italic' }}>No requirements captured yet. Add one below.</p> : (
          <ul>{requirements.map((r) => (
            <li key={r.id}>{r.requirement_ref} — {r.title} [{r.priority}] · {r.status}</li>
          ))}</ul>
        )}
        {canEdit && (
          <div style={{ display: 'grid', gap: 8, marginTop: 10, maxWidth: 500 }}>
            <input placeholder="Requirement ref (unique)" value={reqRef} onChange={(e) => setReqRef(e.target.value)} style={box} />
            <input placeholder="Title" value={reqTitle} onChange={(e) => setReqTitle(e.target.value)} style={box} />
            <select value={reqPriority} onChange={(e) => setReqPriority(e.target.value)} style={box}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <button onClick={addRequirement} style={{ padding: 8 }}>Add requirement</button>
          </div>
        )}
      </section>

      <section style={{ marginTop: 30 }}>
        <h2>Development links</h2>
        {devLinks.length === 0 ? <p style={{ color: '#777', fontStyle: 'italic' }}>No development links recorded yet.</p> : (
          <ul>{devLinks.map((l) => (
            <li key={l.id} style={{ marginBottom: 6 }}>
              {l.link_type} — <a href={l.url} target="_blank" rel="noreferrer">{l.url}</a> · {l.verified ? '✅ Verified' : '⏳ Unverified'}
              {!l.verified && canEdit && (
                <button onClick={() => verifyLink(l.id)} style={{ marginLeft: 10, padding: 4 }}>Verify</button>
              )}
            </li>
          ))}</ul>
        )}
        <div style={{ display: 'grid', gap: 8, marginTop: 10, maxWidth: 500 }}>
          <select value={linkType} onChange={(e) => setLinkType(e.target.value)} style={box}>
            <option value="repository">Repository</option>
            <option value="workspace">Workspace</option>
            <option value="task_board">Task board</option>
            <option value="other">Other</option>
          </select>
          <input placeholder="URL" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} style={box} />
          <button onClick={addDevLink} style={{ padding: 8 }}>Record development link</button>
          <p style={{ fontSize: 12, color: '#777' }}>Junior developers may record links; only seniors can verify.</p>
        </div>
      </section>
    </main>
  )
}
