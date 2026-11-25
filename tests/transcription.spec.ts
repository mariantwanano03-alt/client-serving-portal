import { test, expect } from '@playwright/test'
import path from 'node:path'
import { login, shot, shotDir } from './helpers/admin'

const JUNIOR_EMAIL = 'alex@test.com'
const JUNIOR_PASSWORD = 'test1234'
const FIXTURE = path.resolve(process.cwd(), 'tests/fixtures/transcription-test.wav')
const PHRASE = 'Hello, this is a test of the meeting transcription service.'
const SHOTS = shotDir('transcription')

test('TRANSCRIPTION: upload sends the session token and fills the editable transcript', async ({ page }) => {
  let authHeader: string | undefined
  await page.route('**/api/transcribe', async (route) => {
    authHeader = route.request().headers()['authorization']
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ transcript: PHRASE, success: true }),
    })
  })

  await login(page, JUNIOR_EMAIL, JUNIOR_PASSWORD)
  await page.goto('/create-project')
  await expect(page.getByTestId('transcript-input')).toBeVisible()
  await expect(page.getByTestId('transcript-status')).toHaveText('idle')

  await page.getByTestId('audio-file-input').setInputFiles(FIXTURE)

  await expect(page.getByTestId('transcript-status')).toHaveText('ready')
  await expect(page.getByTestId('transcript-input')).toHaveValue(PHRASE)
  expect(authHeader, 'the protected transcription route needs a bearer token').toMatch(/^Bearer .+/)
  await expect(page.locator('text=/Transcribed .* successfully/')).toBeVisible()
  await shot(page, SHOTS, '01-upload-transcript.png')
})

test('TRANSCRIPTION: real Groq transcription of an uploaded recording', async ({ page }) => {
  test.setTimeout(180000)
  await login(page, JUNIOR_EMAIL, JUNIOR_PASSWORD)
  await page.goto('/create-project')
  await expect(page.getByTestId('transcript-input')).toBeVisible()

  await page.getByTestId('audio-file-input').setInputFiles(FIXTURE)

  await expect(page.getByTestId('transcript-status')).toHaveText('ready', { timeout: 120000 })
  await expect(page.getByTestId('transcript-input')).toHaveValue(/Hello, this is a test/)
  await shot(page, SHOTS, '02-real-transcript.png')
})
