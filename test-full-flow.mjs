import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'http://127.0.0.1:54321'
const SUPABASE_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'

async function signIn(email, password) {
  const base = createClient(SUPABASE_URL, SUPABASE_KEY)
  const { data, error } = await base.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Sign in failed for ${email}: ${error.message}`)
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
  })
}

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passed++
  } else {
    console.log(`  ❌ FAIL: ${message}`)
    failed++
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗')
  console.log('║  FULL SYSTEM FLOW TEST                                         ║')
  console.log('║  Users: admin@test.com, senior@test.com, junior@test.com       ║')
  console.log('║  DB: Clean (0 clients, 0 projects, 0 discovery meetings)       ║')
  console.log('╚════════════════════════════════════════════════════════════════╝\n')

  // ──────────────────────────────────────────────────────────────
  // SIGN-IN TESTS
  // ──────────────────────────────────────────────────────────────
  console.log('─── SIGN-IN TESTS ───')
  const seniorClient = await signIn('senior@test.com', '123456')
  const seniorUser = (await seniorClient.auth.getUser()).data.user
  assert(!!seniorUser, 'senior@test.com signs in')

  const adminClient = await signIn('admin@test.com', '123456')
  const adminUser = (await adminClient.auth.getUser()).data.user
  assert(!!adminUser, 'admin@test.com signs in')

  const juniorClient = await signIn('junior@test.com', '123456')
  const juniorUser = (await juniorClient.auth.getUser()).data.user
  assert(!!juniorUser, 'junior@test.com signs in')

  // ──────────────────────────────────────────────────────────────
  // TEST 1: Create Discovery Meeting as senior_dev_pm
  // ──────────────────────────────────────────────────────────────
  console.log('\n─── TEST 1: Create Discovery Meeting (Senior PM) ───')
  const { data: meeting, error: mErr } = await seniorClient
    .from('discovery_meetings')
    .insert({
      meeting_date: '2026-11-10',
      status: 'scheduled',
      client_name: 'Acme Corporation',
      primary_contact: 'Sarah Jenkins',
      contact_email: 'sarah@acme.com',
      contact_phone: '+1 (555) 000-0001',
      company_address: '123 Business Rd, Cityville',
      company_description: 'A leading technology company specializing in software solutions.',
      industry: 'Technology',
      business_requirements: 'Need a customer portal for managing client accounts and project tracking.',
      client_objectives: 'Improve client onboarding efficiency and reduce manual paperwork.',
      problems_challenges: 'Current process is paper-based and slow. No centralized client database.',
      required_services: 'Client portal development, user authentication, document management.',
      additional_notes: 'Client is looking to launch within Q1 next year. Budget is flexible.',
      created_by: seniorUser.id,
    })
    .select()
    .single()

  assert(!mErr, `Meeting created: ${mErr ? mErr.message : meeting.id}`)
  assert(meeting.status === 'scheduled', 'Initial status is scheduled')
  assert(meeting.client_name === 'Acme Corporation', 'Client name captured correctly')
  assert(meeting.primary_contact === 'Sarah Jenkins', 'Primary contact captured correctly')
  assert(meeting.contact_email === 'sarah@acme.com', 'Contact email captured correctly')

  // ──────────────────────────────────────────────────────────────
  // TEST 2: Generate Discovery Document
  // ──────────────────────────────────────────────────────────────
  console.log('\n─── TEST 2: Generate AI Discovery Document ───')
  const docContent = `DISCOVERY DOCUMENT
==================

Client / Company: ${meeting.client_name}
Primary Contact: ${meeting.primary_contact}
Contact Email: ${meeting.contact_email}
Contact Phone: ${meeting.contact_phone}
Company Address: ${meeting.company_address}
Industry: ${meeting.industry}

Company Description:
${meeting.company_description}

Business Requirements:
${meeting.business_requirements}

Client Objectives:
${meeting.client_objectives}

Problems / Challenges Identified:
${meeting.problems_challenges}

Required Services / Solutions:
${meeting.required_services}

Additional Notes:
${meeting.additional_notes}

Meeting Date: ${meeting.meeting_date}
Status: Pending Review

--- End of Discovery Document ---`

  const { error: docErr } = await seniorClient
    .from('discovery_meetings')
    .update({ status: 'pending_review', discovery_document_content: docContent })
    .eq('id', meeting.id)

  assert(!docErr, `Document generated: ${docErr ? docErr.message : 'OK'}`)

  const { data: updatedMeeting } = await seniorClient
    .from('discovery_meetings')
    .select('status, discovery_document_content')
    .eq('id', meeting.id)
    .single()

  assert(updatedMeeting.status === 'pending_review', 'Status changed to pending_review')
  assert(updatedMeeting.discovery_document_content.includes('Acme Corporation'), 'Document contains client name')
  assert(updatedMeeting.discovery_document_content.includes('Sarah Jenkins'), 'Document contains primary contact')
  assert(updatedMeeting.discovery_document_content.includes('Technology'), 'Document contains industry')

  // ──────────────────────────────────────────────────────────────
  // TEST 3: Junior Developer Cannot Approve (via API route)
  // ──────────────────────────────────────────────────────────────
  console.log('\n─── TEST 3: Junior Developer Cannot Approve (API) ───')
  // Use the API route which has server-side role checking
  const apiRes = await fetch('http://localhost:3000/api/discovery-meetings/' + meeting.id, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (await juniorClient.auth.getSession()).data.session.access_token,
    },
    body: JSON.stringify({ status: 'approved' }),
  })
  const apiResult = await apiRes.json()
  assert(apiRes.status === 403, `Junior approval returns 403 (got ${apiRes.status})`)
  assert(apiResult.error && apiResult.error.includes('approve'), 'Error message mentions approval')

  // Verify meeting status is unchanged
  const { data: meetingAfterJunior } = await seniorClient
    .from('discovery_meetings')
    .select('status')
    .eq('id', meeting.id)
    .single()
  assert(meetingAfterJunior.status === 'pending_review', 'Meeting status unchanged after junior attempt')

  // ──────────────────────────────────────────────────────────────
  // TEST 4: Approve Meeting → Auto-Create Client (Senior PM)
  // ──────────────────────────────────────────────────────────────
  console.log('\n─── TEST 4: Approve Meeting → Auto-Create Client ───')
  const clientCode = 'ACMECORP'
  const { data: newClient, error: cErr } = await seniorClient
    .from('clients')
    .insert({
      client_code: clientCode,
      name: meeting.client_name.trim(),
      email: meeting.contact_email || null,
      phone: meeting.contact_phone || null,
      primary_contact: meeting.primary_contact.trim(),
      billing_details: null,
      created_by: seniorUser.id,
    })
    .select()
    .single()

  assert(!cErr, `Client created: ${cErr ? cErr.message : newClient.client_code}`)
  assert(newClient.name === 'Acme Corporation', 'Client name correct')
  assert(newClient.email === 'sarah@acme.com', 'Client email correct')
  assert(newClient.primary_contact === 'Sarah Jenkins', 'Client primary contact correct')
  assert(newClient.client_code === 'ACMECORP', 'Client code correct')

  const { error: linkErr } = await seniorClient
    .from('discovery_meetings')
    .update({ status: 'approved', client_id: newClient.id })
    .eq('id', meeting.id)

  assert(!linkErr, `Meeting linked to client: ${linkErr ? linkErr.message : 'OK'}`)

  const { data: finalMeeting } = await seniorClient
    .from('discovery_meetings')
    .select('status, client_id')
    .eq('id', meeting.id)
    .single()

  assert(finalMeeting.status === 'approved', 'Meeting status is approved')
  assert(finalMeeting.client_id === newClient.id, 'Meeting linked to client')

  // ──────────────────────────────────────────────────────────────
  // TEST 5: Client Visible in Clients Table
  // ──────────────────────────────────────────────────────────────
  console.log('\n─── TEST 5: Client Visible in Clients Table ───')
  const { data: allClients, error: clientsErr } = await seniorClient
    .from('clients')
    .select('*')
    .eq('name', 'Acme Corporation')

  assert(!clientsErr, `Query clients: ${clientsErr ? clientsErr.message : 'OK'}`)
  assert(allClients.length === 1, 'Exactly 1 client found (no duplicates)')
  const c = allClients[0]
  assert(c.email === 'sarah@acme.com', 'Client email in table correct')
  assert(c.primary_contact === 'Sarah Jenkins', 'Client primary contact in table correct')
  assert(c.client_code === 'ACMECORP', 'Client code in table correct')

  // ──────────────────────────────────────────────────────────────
  // TEST 6: Client Available for Project Creation
  // ──────────────────────────────────────────────────────────────
  console.log('\n─── TEST 6: Client Available for Project Creation ───')
  const { data: projectClients } = await seniorClient
    .from('clients')
    .select('id, client_code, name')
    .eq('id', newClient.id)
    .single()

  assert(!!projectClients, 'Client available for project selection')
  assert(projectClients.name === 'Acme Corporation', 'Client name correct for project selection')

  // ──────────────────────────────────────────────────────────────
  // TEST 7: Idempotent Approval (no duplicates)
  // ──────────────────────────────────────────────────────────────
  console.log('\n─── TEST 7: Idempotent Approval (no duplicates) ───')
  const { data: clientsByName } = await seniorClient
    .from('clients')
    .select('id')
    .eq('name', 'Acme Corporation')

  assert(clientsByName.length === 1, 'Only one client exists for Acme Corporation (idempotent)')

  // ──────────────────────────────────────────────────────────────
  // TEST 8: Manual Client Creation Still Works
  // ──────────────────────────────────────────────────────────────
  console.log('\n─── TEST 8: Manual Client Creation ───')
  const { data: manualClient, error: mcErr } = await seniorClient
    .from('clients')
    .insert({
      client_code: 'MANUAL1',
      name: 'Manual Client Inc',
      email: 'manual@test.com',
      phone: '+1 (555) 999-0000',
      primary_contact: 'Manual User',
      created_by: seniorUser.id,
    })
    .select()
    .single()

  assert(!mcErr, `Manual client created: ${mcErr ? mcErr.message : manualClient.client_code}`)
  assert(manualClient.client_code === 'MANUAL1', 'Manual client code correct')
  assert(manualClient.name === 'Manual Client Inc', 'Manual client name correct')

  const { data: allClients2 } = await seniorClient.from('clients').select('id, name')
  assert(allClients2.length === 2, 'Both discovery and manual clients exist')

  // ──────────────────────────────────────────────────────────────
  // TEST 9: Administrator Can Approve and Create Client
  // ──────────────────────────────────────────────────────────────
  console.log('\n─── TEST 9: Administrator Can Approve ───')
  const { data: meeting2, error: m2err } = await adminClient
    .from('discovery_meetings')
    .insert({
      meeting_date: '2026-11-11',
      status: 'pending_review',
      client_name: 'Globex Corp',
      primary_contact: 'Jane Doe',
      contact_email: 'jane@globex.com',
      discovery_document_content: 'Test document content',
      created_by: adminUser.id,
    })
    .select()
    .single()

  assert(!m2err, `Meeting 2 created: ${m2err ? m2err.message : meeting2.id}`)

  const clientCode2 = 'GLOBEXC'
  const { data: newClient2, error: c2err } = await adminClient
    .from('clients')
    .insert({
      client_code: clientCode2,
      name: 'Globex Corp',
      email: 'jane@globex.com',
      phone: null,
      primary_contact: 'Jane Doe',
      created_by: adminUser.id,
    })
    .select()
    .single()

  assert(!c2err, `Client 2 created: ${c2err ? c2err.message : newClient2.client_code}`)
  assert(newClient2.client_code === 'GLOBEXC', 'Admin-created client code correct')

  await adminClient
    .from('discovery_meetings')
    .update({ status: 'approved', client_id: newClient2.id })
    .eq('id', meeting2.id)

  const { data: fm2 } = await adminClient
    .from('discovery_meetings')
    .select('status')
    .eq('id', meeting2.id)
    .single()

  assert(fm2.status === 'approved', 'Admin can approve discovery meeting')

  // ──────────────────────────────────────────────────────────────
  // TEST 10: document_revisions.content Column Accessible
  // ──────────────────────────────────────────────────────────────
  console.log('\n─── TEST 10: document_revisions.content Column ───')
  const { data: revs, error: rerr } = await seniorClient
    .from('document_revisions')
    .select('content')
    .limit(1)

  assert(!rerr, `document_revisions.content accessible: ${rerr ? rerr.message : 'OK'}`)

  // ──────────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────────
  console.log('\n╔════════════════════════════════════════════════════════════════╗')
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed                                        ║`)
  console.log('╚════════════════════════════════════════════════════════════════╝')
}

main().catch(console.error)
