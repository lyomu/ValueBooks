# Phase 13 AI privacy and cross-border review

**Status:** draft scaffold, first pass. **Prepared:** 2026-09-14. **This is not a completed legal
or compliance review.** It is a technical inventory of what data would move, where, and under what
control, written so an actual privacy/legal reviewer (and, for any regulated tenant, their own
counsel) has a concrete, accurate starting point instead of a blank page. Closing 13A requires that
review to actually happen and be documented here or linked from here — this document alone does
not satisfy the gate. Read alongside `docs/PHASE13_AI_THREAT_MODEL.md`, which covers the same
system from a security rather than a privacy/data-residency angle.

## 1. The two inference modes, and what "private" actually means today

|                                 | `AI_MODE=private`                                                                                                                                       | `AI_MODE=hosted_limited`                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where inference runs            | An operator-provisioned, self-hosted DeepSeek-compatible endpoint — ValueBooks does not run or manage this itself                                       | DeepSeek's own hosted API (`api.deepseek.com`)                                                                                                                           |
| Who controls the data once sent | The tenant/operator, via whatever infrastructure they provisioned for `AI_PRIVATE_ENDPOINT`                                                             | DeepSeek, under DeepSeek's own hosted-service terms                                                                                                                      |
| Default state                   | Off (`AI_MODE=off` is the schema default)                                                                                                               | Off, and additionally gated by `phase13.hosted_ai_egress` seeded `default_enabled: false` everywhere                                                                     |
| Production config requirements  | HTTPS endpoint, host must appear in `AI_PRIVATE_ALLOWED_HOSTS`, API key required                                                                        | `AI_HOSTED_MODEL` always required, `AI_HOSTED_API_KEY` required in production                                                                                            |
| Cross-border implication        | Depends entirely on where the operator hosts the endpoint — this document cannot answer that for you; it is a deployment decision made per-installation | Data leaves to whatever infrastructure DeepSeek's hosted API runs on — jurisdiction, subprocessors, and retention are governed by DeepSeek's terms, not ValueBooks' code |

**The load-bearing point:** "private mode" is private in the sense that ValueBooks' code never
talks to a public endpoint under that mode (the public DeepSeek host is explicitly rejected as a
private endpoint in config validation) — it is not private in the sense of "data never leaves the
tenant's own infrastructure" unless the operator specifically provisions it that way. That's a
correct design (the tenant chooses their own inference infrastructure and jurisdiction), but it
means this document cannot make a blanket cross-border claim for private mode either — it depends
on deployment.

## 2. What data would actually be sent, per mode

Identical shape in both modes — see the threat model's §3 for the exhaustive list. Summarized:

**Sent:** capped report row cells/totals (from `reports.view`-authorized data only) and the user's
free-text question, for the two supported capabilities (explain a report, explain a number). No
other Phase 13 capability makes a model call at all — document extraction, categorization,
variance insights, and all six 13F-P2 advisers are deterministic.

**Never sent:** attachment bytes, OCR text, authentication material, other tenants' data, database
credentials.

This means the privacy exposure surface, if hosted mode is ever enabled, is bounded to whatever a
user could already see on screen via a report they're authorized to view — the AI layer does not
expand what data exists, only where an authorized subset of it might additionally travel to.

## 3. What a real reviewer needs to answer before `phase13.hosted_ai_egress` is enabled for any tenant

This document does not answer these — it exists to make sure someone with the authority to answer
them actually does, before the flag is flipped for a real organization. None of these have a
default "probably fine" answer baked into the code; the code's only opinion is that the flag stays
off until someone says otherwise for a specific tenant.

1. **DeepSeek's hosted-service terms.** What does DeepSeek's terms of service and privacy policy
   say about: data retention on their side, whether prompts/responses are used for model training,
   subprocessor list, and breach-notification obligations? (Not evaluated here — pull the current
   terms at the time of review, not from memory, since hosted-API terms change.)
2. **Jurisdiction and data residency.** Where does DeepSeek's hosted API process and store request
   data? Does this conflict with any tenant's own regulatory obligations (e.g., a tenant whose
   accounting data must stay within a specific jurisdiction)? This is very likely to vary by
   tenant, which is exactly why the technical gate is per-organization rather than global.
3. **Lawful basis and tenant consent.** For a tenant to have their report data sent to a
   third-party hosted model, what consent or contractual basis is needed, and how/where is it
   captured? The `ORGANIZATION`-scope `FeatureFlagRule` is the technical _mechanism_ for turning
   this on per-tenant — it is not itself evidence of informed consent having been obtained. A real
   consent-capture step (a signed agreement, an explicit in-product opt-in with disclosure, or
   equivalent) needs to exist and be referenced from wherever the flag gets flipped operationally.
4. **Data minimization.** Is capping to `AI_MAX_CONTEXT_ROWS` rows and stripping to cells/totals
   sufficient minimization, or does a specific tenant's data class require stricter filtering
   before anything reaches a hosted endpoint (e.g., redacting free-text descriptions that might
   contain names or other identifying detail beyond what's needed to answer the question)?
5. **Log and retention review, specific to hosted mode.** `AiRun`/`AiEvidence` already exclude
   prompt/response content by design (see threat model §3) — that part is mode-independent and
   already true today. What this review still needs to confirm is DeepSeek's own retention of the
   request on their side (covered by #1), and whether the existing `AI_RUN_RETENTION_DAYS` policy
   for ValueBooks' own metadata rows needs to differ for hosted-mode runs specifically.
6. **Egress accountability.** If hosted mode is ever enabled for a tenant, who is the accountable
   owner for that decision, and what's the process for a tenant to later revoke it (technically:
   remove or disable the `ORGANIZATION`-scope rule — but who initiates that, and on what trigger)?

## 4. What's already true regardless of this review's outcome

Worth stating plainly so the review isn't mistaken for the only thing standing between "off" and
"on" — these are load-bearing, already-implemented technical facts, not proposals:

- Hosted egress cannot be enabled by an environment variable alone. `AI_MODE=hosted_limited` with
  no flag rule set still behaves as fully disabled — proven by an automated test
  (`ai-model.gateway.test.ts`), not just documented as intended behavior.
- The hosted endpoint is hard-coded (`https://api.deepseek.com`) — there is no configuration
  surface that could redirect hosted-mode egress to a different, unreviewed host.
- The flag defaults to off in every environment this codebase runs in, including the automated
  test harness — nothing in normal development or CI activity exercises real hosted egress.
- Enabling the flag is scoped per-organization, not global — a decision for one tenant cannot
  silently enable egress for every other tenant on the platform.

## 5. Open items

- [ ] Legal/compliance review of DeepSeek's current hosted-API terms (§3.1)
- [ ] Per-tenant jurisdiction/data-residency assessment process defined (§3.2)
- [ ] Consent-capture mechanism defined and documented (§3.3) — separate from, and prerequisite to,
      the technical `FeatureFlagRule` gate
- [ ] Data-minimization decision: is the current cap/shape sufficient, or does it need
      tenant-specific tightening (§3.4)
- [ ] Egress-accountability process (who decides, who can revoke) documented (§3.6)

None of these are started. This document's job was to make them concrete and answerable, not to
answer them.

## Proposed answers — 2026-10-11; awaiting owner/legal decision

These are technical and contractual proposals, **not approval to enable hosted AI**. DeepSeek's
[Open Platform Terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)
(effective 2026-04-29), [Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
(updated 2026-02-10), and [API documentation](https://api-docs.deepseek.com/api/create-chat-completion/)
were read on 2026-10-11. The Open Platform Terms are the more specific developer/API agreement;
legal must confirm which other documents and negotiated terms govern this account.

### §3.1 Hosted API terms — Proposed — awaiting owner/legal decision

The Open Platform Terms §§3.3 and 5.5 put end-user disclosure and lawful-basis obligations on the
developer and say DeepSeek's public privacy policy does not govern end-user processing in a
downstream app. The public Privacy Policy describes inputs being collected, model improvement and
training as possible uses, retention for service/legal/business purposes without a fixed API-input
deletion period, and direct processing/storage in the People's Republic of China. It names service
provider _categories_ and corporate-group processing, but supplies no complete named API
subprocessor list or specific API breach-notification commitment. The terms also assign developers
responsibility for inputs/outputs and require end-user disclosure that AI output may be wrong,
including in financial contexts (§§4 and 8). These public documents do **not** establish an
API-specific no-training guarantee, retention schedule, or residency option. A stateless chat
endpoint should not be mistaken for a promise that request content is never retained or cached.

**Decision needed:** legal obtains the applicable agreement/DPA and written answers on API input
and output training use, cache/log retention and deletion, processing regions, named
subprocessors, breach notice, and international transfer terms. If those terms do not meet
ValueBooks' customer commitments, keep hosted inference unavailable and use an approved private
deployment. Item 19's [draft privacy page](<../apps/web/src/app/(marketing)/privacy/page.tsx>)
and item 40's legal sign-off must reflect the final provider terms and actual data flow.

### §3.2 Jurisdiction and residency — Proposed — awaiting owner/legal decision

For each organization, record its legal entity, operating and customer jurisdictions, data
classes, contractual residency promises, and any sector restrictions. Legal evaluates transfer
law and required safeguards against the provider's written processing-location evidence. The
privacy policy says processing/storage occurs in China; do not infer an alternate API region from
the request hostname. Record the reviewer, source documents/versions, decision, expiration or
reassessment date, and permitted data classes per tenant. A prohibited or unknown transfer means
hosted mode remains off for that tenant. Private mode needs a separate location assessment of the
operator-provisioned endpoint. Use `docs/HOSTED_AI_PRIVACY_ASSESSMENT_TEMPLATE.md` as the
per-organization decision record. The existing approval record is evidence of a completed decision;
it does not replace the underlying assessment, governing agreement, or DPA.

### §3.3 Consent or other lawful basis — Proposed — awaiting owner/legal decision

Capture a versioned organization-level hosted-AI agreement or explicit administrator opt-in that
states the provider, data categories, destination, purpose, retention/training terms, withdrawal
method, and whether affected individuals need a separate notice or lawful basis. Store the signer,
their organization role, timestamp, document version/hash, scope and decision in an auditable
record. Legal decides the applicable lawful basis and who may sign. Only after that record and the
residency assessment are approved should an operator add a tenant-scoped flag rule. The current
`FeatureFlagRule` has `note` and timestamps but no consent artifact or legal-decision relation; a
flag flip alone is insufficient. Revocation must be recorded and must disable the rule promptly.

### §3.4 Data minimization — Proposed — awaiting owner/legal decision

The raw `AiOrchestrator` envelope contains report totals and row cells, source IDs, filters, base
currency, and up to `AI_MAX_CONTEXT_ROWS` rows; it also contains the user's free-text question.
Private mode retains that envelope. Hosted mode now applies a separate technical minimization
policy in `AiModelGateway`: only four approved financial report keys are accepted; only numeric
or boolean cells and numeric-string totals are sent; text descriptions, account/customer names,
references, source IDs, and project/tag IDs are removed; row IDs are replaced by opaque handles;
and the question is capped at 500 characters. The outbound serialized payload and output tokens
are independently capped. `ai-model.gateway.test.ts` asserts that the actual hosted request omits
free text and IDs. This is a conservative baseline, not a legal decision that numeric financial
data may leave a tenant. Legal and the owner must approve the allowed data classes for each
tenant; until then, no real tenant's report data should be sent to hosted inference.

### §3.5 Logs and retention — Proposed — awaiting owner/legal decision

`AiRun`/`AiEvidence` omit prompt and response content and default to a 90-day metadata retention
period. Ordinary HTTP logging serializes method, URL and status, not request bodies; exception
and worker error logging still need targeted sink tests. DeepSeek's public documents do not give
an API-specific fixed retention or cache-deletion guarantee. Legal should decide whether the
metadata period is appropriate and obtain provider-side retention, deletion and log terms before
approval. This question appears in §3 but was omitted from the five item-27 boxes; keep it open
alongside §3.1.

### §3.6 Approval, revocation, and local-key history — Proposed — awaiting owner/legal decision

Proposed authority: the tenant's authorized administrator requests hosted processing; the
ValueBooks owner and legal/privacy owner approve the tenant/data-class assessment; a separate
platform operator enables the organization-specific rule and records the approval reference.
Either the tenant's authorized administrator or the owner/privacy owner can request revocation;
the operator disables the rule immediately, records the event, and rotates/revokes the provider
key if account-wide exposure is suspected. New gateway calls check the flag each time. Requests
already in flight and provider-retained data require a separate incident/deletion process.

The owner's ignored local `apps/api/.env` is described in `docs/P0_HANDOVER.md` as containing
`AI_MODE=hosted_limited` and a live key for manual testing; this review did not read, change, or
copy the key. **Owner record — 2026-10-12:** the owner attests that the key never made a provider
request, so no data left ValueBooks through it. The owner approves a 90-day ValueBooks `AiRun`
metadata retention period and identifies a Superadmin as the technical enabler. This does not
identify the required privacy/legal approver, and does not authorize hosted egress. The governing
agreement is dated 2026-10-01; training use is unclear, subprocessors are not listed, and breach
notification is pending. Its asserted Nairobi processing location and 90-day/deletion-on-request
provider retention require legal confirmation because they conflict with or are not established by
the public provider material reviewed above.
