# Hosted AI Privacy Assessment — Per Organization

**Status:** Proposed — awaiting owner/legal decision. Complete this assessment before creating an
active hosted-egress approval or enabling an organization-scoped egress rule.

## Organization and scope

- Organization ID and legal entity:
- Operating, customer, and regulated-data jurisdictions:
- Proposed provider/model: DeepSeek hosted API / approved model version:
- Requested data scope: `REPORT_EVIDENCE` only:
- Approved report keys and fields: the application currently allows only the four financial keys
  enforced by `AiModelGateway`; list any stricter tenant limitation here.
- Prohibited data classes: personal data, free-text report descriptions/references, source IDs,
  project/tag IDs, attachments, OCR text, and credentials.

## Transfer and residency decision

- Customer contract/data-residency commitments reviewed:
- Provider processing/storage locations and source/version:
- Transfer mechanism/safeguards required:
- Subprocessor and breach-notice evidence:
- Legal reviewer and decision reference:
- Decision: approved / rejected / more evidence required:
- Reassessment date and change triggers (provider terms, model, location, data scope, law):

## Consent and operational accountability

- Lawful basis and required notices/consent:
- Authorized tenant signer, authority, and disclosure version:
- External consent artifact reference and SHA-256 hash:
- ValueBooks owner/privacy approver:
- Platform operator authorized to enable the organization rule:
- Revocation contacts and SLA: immediately disable egress; record the approval revocation; begin
  provider deletion/incident process where applicable.

## Retention and verification

- ValueBooks `AiRun` metadata retention decision (default is 90 days):
- Provider API input/output, cache, log, and deletion terms:
- Evidence that the provider key and egress history have been reviewed:
- Next review date:

This template is a decision record, not a substitute for a governing API agreement, DPA, or legal
advice. Store consent artifacts in the approved legal-record system; record only the reference and
integrity hash in ValueBooks.
