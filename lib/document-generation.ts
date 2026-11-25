// Shared, pure document-generation definitions.
//
// This module is safe to import from both client and server components. It
// contains no database access and no secrets. The server route is responsible
// for loading real project/client/financial records before calling the content
// builder, so no generated document can invent business or financial data.

export const GENERATION_TYPES = [
  'Requirements',
  'Quotation',
  'Proposal',
  'Timeline',
  'SLA',
  'Purchase Order',
  'Invoice',
  'Other',
] as const

export type GenerationType = (typeof GENERATION_TYPES)[number]

export type GenerationFieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'line_items'
  | 'milestones'

export type GenerationField = {
  key: string
  label: string
  kind: GenerationFieldKind
  required?: boolean
  placeholder?: string
  help?: string
  min?: number
}

export type GenerationConfig = {
  label: string
  description: string
  fields: GenerationField[]
}

export const GENERATION_CONFIG: Record<GenerationType, GenerationConfig> = {
  Requirements: {
    label: 'Requirements Document',
    description: 'Functional and non-functional requirements confirmed for the project.',
    fields: [
      { key: 'functional_requirements', label: 'Functional requirements', kind: 'textarea', required: true, placeholder: 'Describe what the system must do…' },
      { key: 'non_functional_requirements', label: 'Non-functional requirements', kind: 'textarea', required: true, placeholder: 'Performance, security, reliability, compliance…' },
      { key: 'constraints', label: 'Constraints and assumptions', kind: 'textarea', placeholder: 'Known constraints or assumptions…' },
      { key: 'stakeholders', label: 'Key stakeholders', kind: 'textarea', placeholder: 'Names or roles only — no internal identifiers…' },
    ],
  },
  Quotation: {
    label: 'Quotation',
    description: 'Priced scope with line items, tax and recorded deposit information.',
    fields: [
      { key: 'line_items', label: 'Line items', kind: 'line_items', required: true, help: 'Use agreed rates and hours. A description, quantity and unit price are required.' },
      { key: 'expenses', label: 'Additional expenses', kind: 'number', min: 0, placeholder: '0.00' },
      { key: 'tax_rate', label: 'Tax rate (%)', kind: 'number', min: 0, placeholder: '0' },
      { key: 'valid_until', label: 'Valid until', kind: 'date' },
      { key: 'notes', label: 'Quotation notes', kind: 'textarea', placeholder: 'Assumptions, exclusions or payment notes…' },
    ],
  },
  Proposal: {
    label: 'Proposal',
    description: 'Project overview, objectives, scope and proposed solution.',
    fields: [
      { key: 'overview', label: 'Project overview', kind: 'textarea', required: true, placeholder: 'Summarise the engagement…' },
      { key: 'objectives', label: 'Objectives', kind: 'textarea', required: true, placeholder: 'List the intended outcomes…' },
      { key: 'scope', label: 'Scope', kind: 'textarea', required: true, placeholder: 'What is included and excluded…' },
      { key: 'solution', label: 'Proposed solution', kind: 'textarea', required: true, placeholder: 'Describe the proposed approach…' },
      { key: 'timeline_summary', label: 'Delivery outline', kind: 'textarea', placeholder: 'High-level phases or milestones…' },
    ],
  },
  Timeline: {
    label: 'Project Timeline',
    description: 'Milestones, estimated durations and relevant dates.',
    fields: [
      { key: 'start_date', label: 'Start date', kind: 'date', required: true },
      { key: 'milestones', label: 'Milestones', kind: 'milestones', required: true, help: 'Add at least one named milestone with a duration or target date.' },
      { key: 'dependencies', label: 'Dependencies', kind: 'textarea', placeholder: 'Client decisions, access or third-party dependencies…' },
    ],
  },
  SLA: {
    label: 'Service Level Agreement (SLA)',
    description: 'Draft agreement for the external sister system to present for client signing.',
    fields: [
      { key: 'service_terms', label: 'Service terms', kind: 'textarea', required: true, placeholder: 'Services covered and service standards…' },
      { key: 'responsibilities', label: 'Responsibilities', kind: 'textarea', required: true, placeholder: 'Client and provider responsibilities…' },
      { key: 'support_hours', label: 'Support hours', kind: 'text', placeholder: 'e.g. Monday to Friday, 09:00–17:00' },
      { key: 'response_times', label: 'Response times', kind: 'textarea', placeholder: 'Target response and resolution times…' },
      { key: 'term', label: 'Agreement term', kind: 'text', placeholder: 'e.g. 12 months from the signed date' },
      { key: 'exclusions', label: 'Exclusions', kind: 'textarea', placeholder: 'Anything excluded from the agreement…' },
    ],
  },
  'Purchase Order': {
    label: 'Purchase Order (PO)',
    description: 'Order details, supplier information and recorded financial context.',
    fields: [
      { key: 'po_number', label: 'PO number', kind: 'text', required: true, placeholder: 'PO-0000' },
      { key: 'supplier', label: 'Supplier', kind: 'text', required: true, placeholder: 'Supplier legal or trading name' },
      { key: 'order_details', label: 'Order details', kind: 'textarea', required: true, placeholder: 'Describe the goods or services ordered…' },
      { key: 'line_items', label: 'Line items', kind: 'line_items', required: true },
      { key: 'payment_terms', label: 'Payment terms', kind: 'textarea', placeholder: 'Agreed payment terms…' },
      { key: 'delivery_date', label: 'Delivery date', kind: 'date' },
    ],
  },
  Invoice: {
    label: 'Invoice',
    description: 'Invoice number, client details, line items and payment information.',
    fields: [
      { key: 'invoice_number', label: 'Invoice number', kind: 'text', required: true, placeholder: 'INV-0000' },
      { key: 'line_items', label: 'Line items', kind: 'line_items', required: true },
      { key: 'tax_rate', label: 'Tax rate (%)', kind: 'number', min: 0, placeholder: '0' },
      { key: 'due_date', label: 'Payment due date', kind: 'date' },
      { key: 'payment_details', label: 'Payment details', kind: 'textarea', placeholder: 'Bank or payment reference details supplied by the business…' },
      { key: 'notes', label: 'Invoice notes', kind: 'textarea', placeholder: 'Optional notes…' },
    ],
  },
  Other: {
    label: 'Other Document',
    description: 'A supported document for any other authorized project purpose.',
    fields: [
      { key: 'purpose', label: 'Purpose', kind: 'text', required: true, placeholder: 'Why this document is needed' },
      { key: 'details', label: 'Document content', kind: 'textarea', required: true, placeholder: 'Enter the document content…' },
    ],
  },
}

export type LineItem = {
  description: string
  quantity: number | string
  unit_price: number | string
}

export type Milestone = {
  name: string
  duration: string
  date: string
}

export type GenerationFields = Record<string, unknown>

export type FinancialContext = {
  currency: string | null
  reference: string | null
  dueDate: string | null
  requiredCents: number
  paidCents: number
  outstandingCents: number
  status: string | null
  requirementStatus: string | null
}

export type GeneratedDocumentInput = {
  type: GenerationType
  title: string
  project: { name: string; reference: string; description: string; stage: string; status: string }
  client: { name: string; primaryContact: string; email: string; phone: string }
  facts: Record<string, string>
  transcript: string
  fields: GenerationFields
  financial: FinancialContext | null
  generatedOn?: Date
}

function isGenerationType(value: string): value is GenerationType {
  return (GENERATION_TYPES as readonly string[]).includes(value)
}

export function normalizeGenerationType(value: unknown): GenerationType | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (isGenerationType(trimmed)) return trimmed

  // Legacy callers used these type codes. They are accepted at the boundary
  // only so that no in-flight request can bypass validation; the UI no longer
  // exposes them and new documents are stored under the canonical type.
  const aliases: Record<string, GenerationType> = {
    PRD: 'Requirements',
    SRS: 'Requirements',
    'Requirements Document': 'Requirements',
    'Project Timeline': 'Timeline',
    'Service Level Agreement': 'SLA',
    'Service Level Agreement (SLA)': 'SLA',
    PO: 'Purchase Order',
  }
  return aliases[trimmed] || null
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isDate(value: unknown): boolean {
  if (!hasText(value)) return false
  const raw = (value as string).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false
  const parsed = new Date(`${raw}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw
}

function asLineItems(value: unknown): LineItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .map((row) => ({
      description: typeof row.description === 'string' ? row.description.trim() : '',
      quantity: typeof row.quantity === 'number' || typeof row.quantity === 'string' ? row.quantity : '',
      unit_price: typeof row.unit_price === 'number' || typeof row.unit_price === 'string' ? row.unit_price : '',
    }))
}

function asMilestones(value: unknown): Milestone[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .map((row) => ({
      name: typeof row.name === 'string' ? row.name.trim() : '',
      duration: typeof row.duration === 'string' ? row.duration.trim() : '',
      date: typeof row.date === 'string' ? row.date.trim() : '',
    }))
}

export function validateGenerationFields(type: GenerationType, fields: GenerationFields): string | null {
  const config = GENERATION_CONFIG[type]
  for (const field of config.fields) {
    const value = fields[field.key]

    if (field.kind === 'line_items') {
      const items = asLineItems(value)
      if (field.required && items.length === 0) {
        return `Add at least one ${field.label.toLowerCase()} entry.`
      }
      if (items.length > 0) {
        for (const item of items) {
          if (!item.description) return `Every line item needs a description.`
          const quantity = numeric(item.quantity)
          const price = numeric(item.unit_price)
          if (quantity === null || quantity < 0) return `Line item quantities must be zero or greater.`
          if (price === null || price < 0) return `Line item prices must be zero or greater.`
        }
      }
      continue
    }

    if (field.kind === 'milestones') {
      const milestones = asMilestones(value)
      if (field.required && milestones.length === 0) {
        return 'Add at least one milestone.'
      }
      if (milestones.length > 0) {
        for (const milestone of milestones) {
          if (!milestone.name) return 'Every milestone needs a name.'
          if (milestone.date && !isDate(milestone.date)) return 'Milestone dates must be valid calendar dates.'
        }
      }
      continue
    }

    if (field.required && !hasText(value) && !(field.kind === 'number' && numeric(value) !== null)) {
      return `${field.label} is required.`
    }
    if (!hasText(value) && numeric(value) === null) continue

    if (field.kind === 'number') {
      const amount = numeric(value)
      if (amount === null || amount < 0) return `${field.label} must be a valid number.`
      if (field.key === 'tax_rate' && amount > 100) return 'Tax rate cannot exceed 100%.'
      if (typeof field.min === 'number' && amount < field.min) return `${field.label} is too small.`
    }
    if (field.kind === 'date' && hasText(value) && !isDate(value)) {
      return `${field.label} must be a valid date.`
    }
  }
  return null
}

function text(fields: GenerationFields, key: string): string {
  const value = fields[key]
  return typeof value === 'string' ? value.trim() : ''
}

function numberOrZero(value: unknown): number {
  const parsed = numeric(value)
  return parsed ?? 0
}

function money(amount: number, currency: string | null): string {
  const code = currency || 'ZAR'
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: code }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${code}`
  }
}

function moneyFromCents(cents: number, currency: string | null): string {
  return money((Number(cents) || 0) / 100, currency)
}

function displayDate(value: unknown): string {
  if (!hasText(value)) return 'Not recorded'
  const raw = (value as string).trim()
  const date = isDate(raw) ? new Date(`${raw}T00:00:00Z`) : new Date(raw)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toISOString().slice(0, 10)
}

function paragraph(value: string): string {
  return value.trim() || 'Not recorded'
}

function multiline(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'Not recorded'
  return trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => `- ${line}`).join('\n')
}

function lineItemRows(items: LineItem[], currency: string | null) {
  if (!items.length) return ['| Description | Quantity | Unit price | Amount |', '| --- | ---: | ---: | ---: |', '| Not recorded | — | — | — |'].join('\n')

  const rows = items.map((item) => {
    const quantity = numberOrZero(item.quantity)
    const price = numberOrZero(item.unit_price)
    return `| ${item.description.replace(/\|/g, '\\|')} | ${quantity} | ${money(price, currency)} | ${money(quantity * price, currency)} |`
  })
  return [
    '| Description | Quantity | Unit price | Amount |',
    '| --- | ---: | ---: | ---: |',
    ...rows,
  ].join('\n')
}

function financialBlock(financial: FinancialContext | null): string {
  if (!financial) return 'No financial record is linked to this project.'
  return [
    `- **Deposit reference:** ${financial.reference || 'Not recorded'}`,
    `- **Currency:** ${financial.currency || 'ZAR'}`,
    `- **Required:** ${moneyFromCents(financial.requiredCents, financial.currency)}`,
    `- **Paid:** ${moneyFromCents(financial.paidCents, financial.currency)}`,
    `- **Outstanding:** ${moneyFromCents(financial.outstandingCents, financial.currency)}`,
    `- **Due date:** ${displayDate(financial.dueDate)}`,
    `- **Record status:** ${financial.status || financial.requirementStatus || 'Not recorded'}`,
  ].join('\n')
}

function factBlock(facts: Record<string, string>, labels: string[]): string {
  const rows = labels.map((label) => facts[label] ? `- **${label}:** ${facts[label]}` : '').filter(Boolean)
  return rows.length ? rows.join('\n') : '- No details were captured during discovery.'
}

export function buildGeneratedContent(input: GeneratedDocumentInput): string {
  const currency = input.financial?.currency || null
  const items = asLineItems(input.fields.line_items)
  const subtotal = items.reduce((sum, item) => sum + numberOrZero(item.quantity) * numberOrZero(item.unit_price), 0)
  const taxRate = numberOrZero(input.fields.tax_rate)
  const expenses = numberOrZero(input.fields.expenses)
  const tax = subtotal * (taxRate / 100)
  const total = subtotal + tax + expenses
  const configuredDate = input.generatedOn || new Date()

  const header = [
    `# ${input.title}`,
    '',
    `**Project:** ${input.project.name} (${input.project.reference})`,
    `**Client:** ${input.client.name}`,
    `**Prepared:** ${configuredDate.toISOString().slice(0, 10)}`,
    '',
    `**Client contact:** ${input.client.primaryContact || 'Not recorded'}`,
    `**Contact email:** ${input.client.email || 'Not recorded'}`,
    `**Contact phone:** ${input.client.phone || 'Not recorded'}`,
    '',
  ].join('\n')

  const discovery = input.facts && Object.keys(input.facts).length
    ? factBlock(input.facts, ['Business requirements', 'Client objectives', 'Required services', 'Problems / challenges', 'Industry', 'Company description'])
    : ''
  const transcript = input.transcript?.trim()
    ? `## Discovery Notes\n\n${input.transcript.trim()}`
    : ''

  let body = ''

  switch (input.type) {
    case 'Requirements':
      body = [
        '## Project Context',
        paragraph(input.project.description) || 'Not recorded',
        '',
        '## Functional Requirements',
        multiline(text(input.fields, 'functional_requirements')),
        '',
        '## Non-Functional Requirements',
        multiline(text(input.fields, 'non_functional_requirements')),
        '',
        '## Constraints and Assumptions',
        multiline(text(input.fields, 'constraints')),
        '',
        '## Key Stakeholders',
        multiline(text(input.fields, 'stakeholders')),
        discovery ? `\n## Confirmed Discovery Details\n\n${discovery}` : '',
        transcript,
      ].filter(Boolean).join('\n\n')
      break

    case 'Quotation':
      body = [
        '## Scope',
        paragraph(input.project.description) || 'Not recorded',
        '',
        '## Line Items',
        lineItemRows(items, currency),
        '',
        '## Summary',
        `- **Subtotal:** ${money(subtotal, currency)}`,
        `- **Additional expenses:** ${money(expenses, currency)}`,
        `- **Tax (${taxRate}%):** ${money(tax, currency)}`,
        `- **Estimated total:** ${money(total, currency)}`,
        `- **Valid until:** ${displayDate(input.fields.valid_until)}`,
        '',
        '## Deposit Information',
        financialBlock(input.financial),
        '',
        '## Notes',
        multiline(text(input.fields, 'notes')),
      ].join('\n')
      break

    case 'Proposal':
      body = [
        '## Project Overview',
        paragraph(text(input.fields, 'overview')),
        '',
        '## Objectives',
        multiline(text(input.fields, 'objectives')),
        '',
        '## Scope',
        multiline(text(input.fields, 'scope')),
        '',
        '## Proposed Solution',
        paragraph(text(input.fields, 'solution')),
        '',
        '## Delivery Outline',
        multiline(text(input.fields, 'timeline_summary')),
        discovery ? `\n## Client Context\n\n${discovery}` : '',
        transcript,
      ].filter(Boolean).join('\n\n')
      break

    case 'Timeline': {
      const milestones = asMilestones(input.fields.milestones)
      const rows = milestones.length
        ? [
            '| Milestone | Estimated duration | Target date |',
            '| --- | --- | --- |',
            ...milestones.map((milestone) => `| ${milestone.name.replace(/\|/g, '\\|')} | ${milestone.duration || 'Not recorded'} | ${displayDate(milestone.date)} |`),
          ].join('\n')
        : '| Milestone | Estimated duration | Target date |\n| --- | --- | --- |\n| Not recorded | — | — |'
      body = [
        '## Timeline',
        `- **Start date:** ${displayDate(input.fields.start_date)}`,
        '',
        rows,
        '',
        '## Dependencies',
        multiline(text(input.fields, 'dependencies')),
      ].join('\n')
      break
    }

    case 'SLA':
      body = [
        '## Service Terms',
        paragraph(text(input.fields, 'service_terms')),
        '',
        '## Responsibilities',
        multiline(text(input.fields, 'responsibilities')),
        '',
        '## Support Arrangements',
        `- **Support hours:** ${text(input.fields, 'support_hours') || 'Not recorded'}`,
        `- **Agreement term:** ${text(input.fields, 'term') || 'Not recorded'}`,
        '',
        '## Response Times',
        multiline(text(input.fields, 'response_times')),
        '',
        '## Exclusions',
        multiline(text(input.fields, 'exclusions')),
        '',
        '## Signing',
        'This draft is prepared in the Client Serving Portal for the client to review and sign through the external signing service.',
      ].join('\n')
      break

    case 'Purchase Order':
      body = [
        '## Order Details',
        `- **PO number:** ${text(input.fields, 'po_number') || 'Not recorded'}`,
        `- **Supplier:** ${text(input.fields, 'supplier') || 'Not recorded'}`,
        `- **Delivery date:** ${displayDate(input.fields.delivery_date)}`,
        '',
        paragraph(text(input.fields, 'order_details')),
        '',
        '## Line Items',
        lineItemRows(items, currency),
        '',
        '## Summary',
        `- **Subtotal:** ${money(subtotal, currency)}`,
        `- **Tax (${taxRate}%):** ${money(tax, currency)}`,
        `- **Estimated total:** ${money(total, currency)}`,
        '',
        '## Recorded Financial Information',
        financialBlock(input.financial),
        '',
        '## Payment Terms',
        multiline(text(input.fields, 'payment_terms')),
      ].join('\n')
      break

    case 'Invoice': {
      const dueDate = text(input.fields, 'due_date') || input.financial?.dueDate || ''
      body = [
        '## Invoice Details',
        `- **Invoice number:** ${text(input.fields, 'invoice_number') || 'Not recorded'}`,
        `- **Billed to:** ${input.client.name}`,
        `- **Payment due:** ${displayDate(dueDate)}`,
        '',
        '## Line Items',
        lineItemRows(items, currency),
        '',
        '## Amounts',
        `- **Subtotal:** ${money(subtotal, currency)}`,
        `- **Tax (${taxRate}%):** ${money(tax, currency)}`,
        `- **Total due:** ${money(total, currency)}`,
        '',
        '## Recorded Financial Information',
        financialBlock(input.financial),
        '',
        '## Payment Details',
        multiline(text(input.fields, 'payment_details')),
        '',
        '## Notes',
        multiline(text(input.fields, 'notes')),
      ].join('\n')
      break
    }

    case 'Other':
      body = [
        '## Purpose',
        paragraph(text(input.fields, 'purpose')),
        '',
        '## Details',
        paragraph(text(input.fields, 'details')),
        discovery ? `\n## Project Context\n\n${discovery}` : '',
      ].filter(Boolean).join('\n\n')
      break
  }

  return `${header}${body.trim()}\n`
}

export function generationFieldKeys(type: GenerationType): string[] {
  return GENERATION_CONFIG[type].fields.map((field) => field.key)
}

export function defaultGenerationFields(type: GenerationType): GenerationFields {
  const fields: GenerationFields = {}
  for (const field of GENERATION_CONFIG[type].fields) {
    if (field.kind === 'line_items') fields[field.key] = []
    else if (field.kind === 'milestones') fields[field.key] = []
    else fields[field.key] = ''
  }
  return fields
}

export function labelForGenerationType(type: GenerationType): string {
  return GENERATION_CONFIG[type].label
}
