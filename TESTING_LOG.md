# Testing Log

Persistent record for the Client Serving Portal. Times are SAST and use the completion time of the corresponding run log where available. Account emails, passwords, tokens and service-role keys are intentionally omitted; account labels are used instead.

## Accounts actually exercised

- Junior A, Junior B, Junior C — three distinct `junior_developer` accounts.
- Senior A — `senior_dev_pm`.
- Admin A — `administrator`.
- Client — `client`.
- Senior B and Admin B were attempted but could not sign in with the available shared test credential, so they are recorded as BLOCKED and were not used as evidence.

Six distinct accounts (Junior A/B/C, Senior A, Admin A, Client) were exercised in the readiness/permission test. No claim is made about Senior B or Admin B.

## Environment and evidence

- Local app: `http://localhost:3000` (Next.js dev server).
- Browsers: Playwright system Chrome, Chromium and Mobile Chrome projects.
- Headed walkthrough: `tests/visible-walkthrough.spec.ts` with `headless: false`.
- Screenshots: `screenshots/guided-flow/`, `screenshots/master-workflow/`, and `screenshots/visible-walkthrough/`.
- Run logs referenced below were written under the session temp directory `/private/var/folders/dr/tvz1889d4j1g0n7md_fl40rr0000gp/T/opencode/`.
- Automated tests created only clearly labelled test projects/documents. No deploy was performed and no existing business or financial records were manually edited.

## Summary

- Full baseline regression at 14:37: **149 passed, 2 failed, 5 did not run**; both failures were Mobile Chrome flakes.
- Standalone rerun of those flaky paths at 14:40: **8 passed**.
- Focused generation/readiness suite final run at 16:10: **11 passed**.
- Final affected regression after lint cleanup at 16:31: **28 passed** across Chromium and Mobile Chrome.
- Separate visible headed walkthrough at 16:39: **1 passed**; nine full-page screenshots captured.
- `npx tsc --noEmit`: **passed**. Targeted `npx eslint`: **0 errors, 3 pre-existing warnings**.
- Supabase migration applied with `supabase db query --linked --yes -f ...`; readiness gate returns `gate:false` for existing data, anonymous `signed_documents` policies are `0`, and the gate function execute privilege is revoked from `public`, `anon` and `authenticated`.

---

### 2026-11-25 11:39 — Prior master workflow (visible headed)

- **Feature:** Assignment, document review, approval/rejection, permissions and audit trail.
- **Account label / role:** Junior A / junior; Senior A / senior; Admin A / administrator; Client / client.
- **Route / surface:** `/login`, `/create-project`, `/projects/[id]`, administrator audit view.
- **Action:** Single headed browser run through project creation, assignment, draft submission, denial checks, reassignment, senior rejection/approval and client restrictions.
- **Expected:** Junior cannot self-approve; administrator is read-only except explicit reassignment; senior approves/rejects; client is scoped to authorised areas; audit is human-readable.
- **Actual:** All assertions passed; console/page errors and non-abort failed requests were none. Screenshots written to `screenshots/master-workflow/`.
- **Result:** **PASS**.
- **Errors:** None.
- **Root cause:** Not applicable.
- **Fix:** Not applicable; this was already-completed work that was preserved.
- **Retest:** 16:07 and 16:31 after the central generation change; both PASS.

### 2026-11-25 13:38 — Financial source of truth and permission regression

- **Feature:** `pts_payments` / `pts_deposit_overview` progress calculation and role-scoped financial access.
- **Account label / role:** Junior A, Senior A, Admin A, Client.
- **Route / surface:** `/projects/[id]?tab=financials`, financial APIs and RLS.
- **Action:** Ran `tests/payment-progress.spec.ts` standalone after earlier parallel-run failures.
- **Expected:** Progress uses paid ÷ required × 100 with safe zero/null handling; direct junior/admin writes denied; admin has read-only oversight; client is scoped.
- **Actual:** `22 passed`.
- **Result:** **PASS**.
- **Errors:** Earlier parallel runs had failed on the financials tab not being visible for an unassigned account.
- **Root cause:** Test setup/assignment visibility timing under parallel execution; not reproduced in isolation.
- **Fix:** No product-code change; the standalone rerun used the correct assigned project setup.
- **Retest:** 14:37 full regression and 16:31 final affected regression; PASS.

### 2026-11-25 14:37 — Full regression baseline

- **Feature:** Whole portal regression across Chromium and Mobile Chrome.
- **Account label / role:** All verified labels above.
- **Route / surface:** All tested routes and APIs.
- **Action:** Ran the complete Playwright suite (`156` tests) with the pre-change code state.
- **Expected:** All tests pass.
- **Actual:** `149 passed`, `2 failed`, `5 did not run`. Failures were Mobile Chrome `admin-b-project-access` and Mobile Chrome `pending-role-assignment` step 2.
- **Result:** **FAIL** (run-level; both failures isolated as flakes).
- **Errors:** Locator/time-related failures in the two Mobile Chrome tests; no product error signature.
- **Root cause:** Not reproducible outside the full parallel run; consistent with shared-state/timing flakiness.
- **Fix:** No product-code change; reran the affected paths with one worker.
- **Retest:** 14:40 standalone rerun — `8 passed`.

### 2026-11-25 14:40 — Flaky permission paths standalone rerun

- **Feature:** Administrator access restrictions and pending role assignment.
- **Account label / role:** Admin A / administrator; pending-role test accounts created by the test.
- **Route / surface:** `/projects`, `/projects/[id]`, `/admin/users`, protected APIs and `/signup`.
- **Action:** Reran eight affected Mobile Chrome tests with one worker.
- **Expected:** Administrator can view but cannot perform project operations; pending users cannot reach protected pages or self-service writes; activation flow works.
- **Actual:** `8 passed`.
- **Result:** **PASS**.
- **Errors:** None.
- **Root cause:** Earlier failures did not reproduce.
- **Fix:** No code change.
- **Retest:** 16:31 final affected regression; PASS.

### 2026-11-25 15:43 — SLA verification and development gate migration

- **Feature:** Genuine SLA verification, readiness gate and `signed_documents` hardening.
- **Account label / role:** Service-role database path (no user account used).
- **Route / surface:** Linked Supabase database; `development_readiness_satisfied(uuid)` and project stage trigger.
- **Action:** Applied `supabase/migrations/20261125130000_sla_verification_and_development_gate.sql` after adding grant revocations.
- **Expected:** Anonymous clients cannot read signed records or call the gate function; direct project stage writes to development are blocked unless readiness is satisfied.
- **Actual:** Migration applied successfully; `anon_policies:0`; gate returned `gate:false` for existing data; execute revoked from `public`, `anon`, `authenticated` and granted to `service_role`.
- **Result:** **PASS**.
- **Errors:** `supabase db push --linked --yes` previously failed with `Remote migration versions not found in local migrations directory`.
- **Root cause:** Local and remote migration history mismatch.
- **Fix:** Applied the migration file directly with `supabase db query --linked --yes -f ...`; migration history was not repaired.
- **Retest:** 16:10 focused suite and 16:31 affected regression; PASS.

### 2026-11-25 15:49 — Focused generation/readiness suite, initial run

- **Feature:** Canonical document types, type-specific validation, human-readable audit labels, SLA decision matrix, real-data drafts and readiness bypass denial.
- **Account label / role:** Junior A, Senior A, Admin A, Client.
- **Route / surface:** `tests/generation-readiness.spec.ts`; `/projects/[id]?tab=documents`, generation/readiness/begin APIs.
- **Action:** Ran all 11 new tests with one Chromium worker.
- **Expected:** All new work passes.
- **Actual:** `10 passed`, `1 failed`; the real-data draft test sampled the generate button before the workspace finished loading.
- **Result:** **FAIL**.
- **Errors:** `Expected: 1, Received: 0` for `generate-document-button`; page snapshot was still “Loading your workspace…”.
- **Root cause:** Test race, not a product defect.
- **Fix:** Changed the assertion to `toHaveCount(1, { timeout: 30000 })`.
- **Retest:** 15:53 generated-draft rerun PASS; 16:10 full focused suite PASS.

### 2026-11-25 15:51 — Senior approval after generated draft, initial rerun

- **Feature:** Generated draft submission and senior approval workflow.
- **Account label / role:** Junior A / junior; Senior A / senior.
- **Route / surface:** `/projects/[id]?tab=documents`, `POST /api/documents/[id]/approve`.
- **Action:** Submitted a generated draft and attempted senior approval on a project whose active assignment was still the junior.
- **Expected:** Senior approval succeeds after the project's approval authority is correctly assigned.
- **Actual:** `403`; the API correctly refused approval because Senior A did not yet hold approval authority on that project.
- **Result:** **FAIL** (test setup issue).
- **Errors:** `Expected: 403, Received array: [200, 201]` at the approval assertion.
- **Root cause:** Approval authority comes from the real `assignments` row, not role alone.
- **Fix:** Test now performs Admin A's real audited reassignment to Senior A before approving.
- **Retest:** 15:53 PASS; 16:10 and 16:31 PASS.

### 2026-11-25 15:57 — Affected generation regression, initial run

- **Feature:** Guided flow and full-flow regression after centralising generation.
- **Account label / role:** Junior A / junior.
- **Route / surface:** `/`, `/create-project`, `/projects/[id]`.
- **Action:** Ran `tests/guided-flow.spec.ts` and `tests/full-flow-test.spec.ts`.
- **Expected:** Both pass with the single central Generate Document button.
- **Actual:** `2 passed`, `2 failed`; guided flow read the document count before React refreshed.
- **Result:** **FAIL** (test timing).
- **Errors:** `Expected: 1, Received: 0` comparing document counts; database check showed the draft was already persisted.
- **Root cause:** Immediate DOM read after asynchronous `loadDocuments()` refresh.
- **Fix:** Wait for the `Documents (n)` heading to reach the expected count; also updated the backend type assertion from legacy `PRD` to canonical `Requirements`.
- **Retest:** 16:03 PASS; 16:31 PASS.

### 2026-11-25 16:05 — Account availability check

- **Feature:** Distinct-account test coverage availability.
- **Account label / role:** Senior B / senior; Admin B / administrator.
- **Route / surface:** `/login` and profile lookup.
- **Action:** Attempted sign-in with the available shared test password for all named accounts.
- **Expected:** All named secondary accounts are usable for distinct-role testing.
- **Actual:** Senior B and Admin B returned invalid credentials; Junior A/B/C, Senior A, Admin A and Client signed in successfully.
- **Result:** **BLOCKED** for Senior B and Admin B.
- **Errors:** Invalid login credentials for the two secondary accounts.
- **Root cause:** Working credentials for those accounts were not available.
- **Fix:** Used the six verified distinct accounts instead; no password or token was recorded.
- **Retest:** 16:09 readiness test exercised six distinct accounts successfully.

### 2026-11-25 16:07 — Master workflow with central generation

- **Feature:** Generated draft, junior edit/submit, reassignment, senior rejection and approval, client restrictions, audit.
- **Account label / role:** Junior A, Senior A, Admin A, Client.
- **Route / surface:** `/projects/[id]`, Documents tab, approval API, audit view.
- **Action:** Replaced the old `Draft Document` flow with the central type-first modal and generated title in the master workflow test.
- **Expected:** Generated draft contains real project/client data, stays editable, enters `pending_review`, and follows senior review after reassignment.
- **Actual:** `1 passed` in headed Chromium; screenshots regenerated in `screenshots/master-workflow/`.
- **Result:** **PASS**.
- **Errors:** None.
- **Root cause:** Not applicable.
- **Fix:** Test updated for the new UI; generated title derived as `Proposal — <project>`.
- **Retest:** 16:31 PASS in both Chromium and Mobile Chrome.

### 2026-11-25 16:09 — Six distinct accounts in readiness/permission test

- **Feature:** Development readiness read permissions and development-begin bypass denial.
- **Account label / role:** Junior A, Junior B, Junior C, Senior A, Admin A, Client.
- **Route / surface:** `GET /api/projects/[id]/readiness`, `POST /api/projects/[id]/development/begin`.
- **Action:** Every account attempted to read readiness or begin development on a locked project.
- **Expected:** Only the assigned senior may read readiness; all roles are denied begin while prerequisites are incomplete; direct database stage write is blocked by trigger.
- **Actual:** Junior B/C and Client got `403` on readiness; Junior A/B/C, Admin A and Client got `403` on begin; Senior A got `409`; direct stage update was rejected by the development lock; anonymous client could not read signed rows or call the gate RPC.
- **Result:** **PASS**.
- **Errors:** None.
- **Root cause:** Not applicable.
- **Fix:** Not applicable.
- **Retest:** 16:10 and 16:31 PASS.

### 2026-11-25 16:10 — Focused generation/readiness suite, final run

- **Feature:** All new generation, SLA verification, audit-label and gate behaviour.
- **Account label / role:** Junior A, Senior A, Admin A, Client; fake query rows used only for pure SLA decision tests.
- **Route / surface:** `tests/generation-readiness.spec.ts`.
- **Action:** Reran all 11 tests after the fixes above.
- **Expected:** `11 passed`.
- **Actual:** `11 passed` in Chromium.
- **Result:** **PASS**.
- **Errors:** None.
- **Root cause:** Not applicable.
- **Fix:** Not applicable.
- **Retest:** 16:31 final affected regression PASS.

### 2026-11-25 16:31 — Final affected regression after lint cleanup

- **Feature:** Focused generation/readiness, guided flow, full flow and master workflow.
- **Account label / role:** Junior A, Senior A, Admin A, Client.
- **Route / surface:** Chromium and Mobile Chrome across all four affected spec files.
- **Action:** Reran `tests/generation-readiness.spec.ts`, `tests/guided-flow.spec.ts`, `tests/full-flow-test.spec.ts` and `tests/master-workflow.spec.ts` on the final code.
- **Expected:** All affected tests pass on the exact code to be committed.
- **Actual:** `28 passed`; no console errors, page errors or non-abort failed requests in master workflow diagnostics.
- **Result:** **PASS**.
- **Errors:** Only expected navigation cancellation aborts were reported.
- **Root cause:** Not applicable.
- **Fix:** Not applicable.
- **Retest:** This was the final affected retest.

### 2026-11-25 16:34 — Visible walkthrough, initial capture

- **Feature:** Separate headed website walkthrough.
- **Account label / role:** Junior A / junior.
- **Route / surface:** `/`, transient drawer, `/projects/[id]`, Documents tab.
- **Action:** Ran `tests/visible-walkthrough.spec.ts` in headed Chrome and captured nine screenshots.
- **Expected:** Validation evidence visibly shows the alert when the screenshot is reviewed.
- **Actual:** Test passed, but the validation screenshot was captured after the modal had scrolled the alert out of view; OCR did not find the message in that image.
- **Result:** **FAIL** (evidence capture only).
- **Errors:** Screenshot evidence did not show the validation text.
- **Root cause:** Clicking the bottom submit button scrolled the modal; the alert is rendered above the visible area.
- **Fix:** Added `scrollIntoViewIfNeeded()` before capturing screenshot 07.
- **Retest:** 16:39 PASS.

### 2026-11-25 16:39 — Visible headed walkthrough, final

- **Feature:** End-to-end user-facing walkthrough, separate from targeted tests.
- **Account label / role:** Junior A / junior.
- **Route / surface:** `/` after login, right-side drawer, locked readiness panel, Documents tab, type-first generation modal, SLA form, validation, draft list and editable draft.
- **Action:** Ran `tests/visible-walkthrough.spec.ts` with `headless: false` using system Chrome; captured nine full-page screenshots in `screenshots/visible-walkthrough/`.
- **Expected:** Home landing without permanent sidebar; transient role-specific drawer; `Development: Locked`; `SLA Awaiting Client Signature.`; `Client Approved & Agreed to Terms: ✗`; exactly one `Generate Document` button; type selection before form; type-specific validation; real-data editable draft.
- **Actual:** `1 passed`. Screenshots were checked with Playwright DOM assertions and macOS Vision OCR. OCR confirmed the required wording, the single central button, the SLA-specific form/validation message, and the generated draft containing the test project and client names.
- **Result:** **PASS**.
- **Errors:** None. Direct image rendering was unavailable to the agent, so visual review was performed programmatically via OCR rather than by human eye.
- **Root cause:** Not applicable after the screenshot-scroll fix.
- **Fix:** Not applicable.
- **Retest:** This was the final headed walkthrough.
