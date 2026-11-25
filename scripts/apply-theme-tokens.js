/* One-off helper: replace hardcoded colour literals with semantic CSS variables
   so the Light/Dark theme applies to the whole application. */
const fs = require('fs')
const path = require('path')

const map = {
  '#14213d': 'var(--heading)',
  '#1e293b': 'var(--text)',
  '#64748b': 'var(--muted)',
  '#94a3b8': 'var(--muted-light)',
  '#f8fafc': 'var(--surface-alt)',
  '#ffffff': 'var(--surface)',
  '#e8ecf3': 'var(--border)',
  '#e2e8f0': 'var(--border-strong)',
  '#f1f5f9': 'var(--border-soft)',
  '#475569': 'var(--border-strong)',
  '#4361ee': 'var(--accent)',
  '#ef4444': 'var(--danger)',
  '#dc2626': 'var(--danger-strong)',
  '#b91c1c': 'var(--error-text)',
  '#fef2f2': 'var(--error-bg)',
  '#fee2e2': 'var(--error-border)',
  '#065f46': 'var(--success-text)',
  '#ecfdf5': 'var(--success-bg)',
  '#a7f3d0': 'var(--success-border)',
  '#f0fbf5': 'var(--success-bg)',
  '#cdeedd': 'var(--success-border)',
  '#267a52': 'var(--success-text)',
}

function replaceIn(text) {
  let out = text
  for (const [hex, variable] of Object.entries(map)) {
    out = out.split(hex).join(variable)
  }
  return out
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

// 1. TSX files
for (const file of [...walk('app'), ...walk('components')]) {
  const before = fs.readFileSync(file, 'utf8')
  const after = replaceIn(before)
  // Dark surfaces must not be used as a text colour on coloured buttons: keep
  // white text where the original source explicitly asked for white text.
  fs.writeFileSync(file, after)
  console.log('tokens:', file)
}

// 2. globals.css - protect the :root/.dark definitions, white text and gradients
const cssPath = 'app/globals.css'
const css = fs.readFileSync(cssPath, 'utf8')
const marker = '@theme inline'
const idx = css.indexOf(marker)
if (idx === -1) throw new Error('marker not found')
const head = css.slice(0, idx)
const tail = css.slice(idx)

const protectedPatterns = [
  /color:\s*#ffffff/g,
  /background:\s*#ffffff99/g,
  /radial-gradient\([^;]*?\)/g,
  /background:\s*#14213d/g,
]
const stash = []
let safeTail = tail
for (const re of protectedPatterns) {
  safeTail = safeTail.replace(re, (m) => {
    stash.push(m)
    return `__KEEP_${stash.length - 1}__`
  })
}
safeTail = replaceIn(safeTail)
stash.forEach((value, i) => {
  safeTail = safeTail.split(`__KEEP_${i}__`).join(value)
})
// Decorative sidebar / banner backgrounds should follow the navy token.
safeTail = safeTail.replace(/background:\s*var\(--heading\)/g, 'background: var(--navy)')

fs.writeFileSync(cssPath, head + safeTail)
console.log('tokens: app/globals.css')
