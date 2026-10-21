# ValueBooks: Document Extraction, OCR & AI Layer Handover

**Date:** 2026-10-15  
**Scope:** Document Extraction & OCR Pipeline, AI Layer Orchestration, and Production Tenant Activation  
**Authority Reference:** `docs/BUILD_ROADMAP.md` (Phase 13), `docs/AI_LAYER_COMPLETION_PLAN.md`, `infrastructure/document-extraction-worker.compose.yml`

---

## 1. Executive Summary & Architectural Invariants

The Document Extraction and AI layer in ValueBooks provides automated receipt/invoice optical character recognition (OCR) and conversational reporting explanations. To maximize platform stability, data confidentiality, and financial accuracy, the architecture enforces strict non-negotiable invariants:

1. **No Autonomous Financial Mutation:** AI models and OCR extraction engines never mutate the general ledger, approve invoices, or post transactions directly. Extractions produce candidate draft objects in a `READY_FOR_REVIEW` state requiring explicit human review and approval.
2. **Deterministic Financial Truth:** Financial amounts and reports originate exclusively from PostgreSQL and deterministic domain services (`ReportingService`). Model output is restricted to explanatory prose or reviewable candidate suggestions.
3. **Hardened Sandbox Isolation:** Untrusted binary parsing (`tesseract.js`, `pdfjs-dist`) executes in a dedicated worker container with memory bounds (`mem_limit: 512m`, `--max-old-space-size=384`), dropped Linux capabilities (`cap_drop: ALL`), read-only root filesystems, and strict input limits (max 5 pages, 15 MB, pixel bounds, and `isEvalSupported: false`).
4. **Tenant Data Privacy by Default:** Document extraction and OCR run 100% locally on self-hosted infrastructure. Third-party egress (`phase13.hosted_ai_egress`) is disabled by default and requires explicit tenant and platform approvals.

---

## 2. Verified Implementation & Baseline Status

All core modules are fully implemented and verified against local live services (PostgreSQL 17, Redis 7.4, MinIO S3, and ClamAV daemon):

### A. Verified Test Suites (100% Pass)
* **Resource & Exploit Boundaries (`test/document-extraction-limits.test.ts`):**
  * Rejection of corrupted, oversized, or malicious PDFs without memory leaks.
  * Validation of strict page caps, dimension limits, character limits, and disabled font/script execution.
* **Full Pipeline Integration (`test/phase13-document-extraction-pipeline.int.test.ts`):**
  * ClamAV pre-scanning with immediate quarantine of infected signatures (EICAR).
  * PDF rasterization and Tesseract OCR text extraction.
  * Vendor, date, line items, and tax candidate extraction into draft expenses.
  * Multi-tenant data segregation (zero cross-tenant candidate or match leakage).
* **AI & Isolation Guardrails (`test/ai.int.test.ts`):**
  * Deterministic SQL drill-down fallback when model egress is unavailable.
  * Dynamic tenant permission re-evaluation on all AI queries.

---

## 3. Production Deployment Runbook

### Step 1: Deploy the Dedicated Worker Container
Launch the dedicated document extraction worker container in the production environment using `infrastructure/document-extraction-worker.compose.yml`:

```bash
# Set production container image tag and start worker service
VALUEBOOKS_API_IMAGE=registry.example.com/valuebooks-api:latest \
  docker compose -f infrastructure/document-extraction-worker.compose.yml up -d
```

**Key Deployment Safeguards:**
* **Network Isolation:** Connect the container exclusively to `valuebooks_internal`. Ensure no public ingress route is exposed to the worker.
* **Resource Limits:** Maintain `mem_limit: 512m` and `cpus: '1.0'` per container instance.
* **Concurrency:** Keep `DOCUMENT_EXTRACTION_WORKER_CONCURRENCY=1` per container and scale horizontally via replica containers if queue volume increases.
* **ClamAV Integration:** Ensure ClamAV daemon (`CLAMAV_HOST=clamav`, `CLAMAV_PORT=3310`) is reachable to quarantine malicious uploads prior to OCR parsing.

### Step 2: Activate Production Tenants
Feature access is controlled via granular feature flags and role-based permissions:

1. **Enable Organization Feature Flags:**
   Activate receipt extraction on target organization records via the Platform Admin API or database configuration:
   * Feature Key: `phase13.receipt_extraction`
   * Target: Set status to `ENABLED` for the specific `organizationId`.
   * *Note:* Keep `phase13.hosted_ai_egress` disabled unless hosted model egress has completed legal review.
2. **Verify User Permissions:**
   Ensure users handling document processing have:
   * `documents.extract` (upload and queue extraction jobs)
   * `expenses.create` / `expenses.edit` (review candidate drafts and create expense records)

---

## 4. Post-Deployment Verification & Smoke Testing

To verify operational health in production:

1. **Queue Connectivity:** Verify that the worker connects to the Redis BullMQ queue (`document-extraction`) without connection retries.
2. **Live Ingestion Check:** Upload a sample invoice (PNG/PDF) within an enabled tenant:
   * Confirm the job transitions through `QUEUED` -> `PROCESSING` -> `READY_FOR_REVIEW`.
   * Check that candidate vendor name, date, total amount, and line items appear in the draft review drawer.
   * Verify that no unreviewed ledger mutations occur.
3. **Malware Quarantine Check:** Confirm that infected uploads (EICAR) trigger status `QUARANTINED` and are removed from processing queues.

---

## 5. Ongoing Monitoring & Incident Response

* **Runbook Reference:** `docs/AI_INCIDENT_RESPONSE_RUNBOOK.md` and `docs/AUTOMATION_OPERATIONS_RUNBOOK.md`.
* **Telemetry & Privacy:** All worker and AI logs redact raw OCR text and attachment payloads, recording only metadata, processing durations, and audit IDs.
* **Worker Crash Recovery:** If a worker instance exhausts memory, Docker restarts the container automatically while BullMQ re-queues or marks the job failed after retry limits without affecting the main API server.
