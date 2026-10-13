# AI Provider Incident Response Runbook

## Scope

Use this runbook for a suspected provider-key exposure, unintended hosted egress, provider outage,
or provider spend anomaly. It deliberately never requires recovering prompts, report cells, OCR text,
or authorization headers from telemetry.

## Immediate containment

1. A Superadmin disables `phase13.ai_assistant` for every affected organization. This stops both
   assistant routes. Disable `phase13.report_drilldown` as a second independent control.
2. For hosted DeepSeek egress, revoke the organization's hosted-egress approval. Revocation also
   disables its explicit organization-scoped `phase13.hosted_ai_egress` rule.
3. Revoke the affected provider key at the provider or secret manager. Replace the deployment secret
   and restart API and AI worker instances. Do not paste or transmit the old or replacement key in a
   ticket, chat, log, or incident document.
4. Verify a request now receives the disabled-service response and that no new `AiRun` records are
   created for the affected organization.

## Provider outage and spend controls

- The shared Redis circuit breaker opens after `AI_CIRCUIT_FAILURE_THRESHOLD` retryable failures
  and closes after `AI_CIRCUIT_OPEN_MS`. Redis unavailability fails closed for provider egress.
- Every outbound attempt has a hard serialized-request ceiling (`AI_MAX_REQUEST_BYTES`) and a
  hard output ceiling (`AI_MAX_OUTPUT_TOKENS`).
- Redis reserves an organization daily token budget before each outbound attempt. At the configured
  warning threshold (`AI_ORGANIZATION_DAILY_ALERT_PERCENT`) it emits content-free operational
  telemetry; it blocks subsequent requests once `AI_ORGANIZATION_DAILY_TOKEN_LIMIT` is exceeded.
- Token budgets are the enforced guardrail. Finance and legal must approve any conversion to a
  currency spend cap when provider price cards and billing currency are recorded.

## Evidence and follow-up

Record the incident time, organization IDs, provider/model identifier, feature-flag and approval
lifecycle actions, token-limit/circuit event metadata, and deployment/secret rotation reference.
Do not attach request bodies, prompts, report evidence, OCR text, or authorization headers.

The platform owner rehearses this procedure quarterly in a non-production environment: disable the
assistant, revoke an approval, rotate a test key, induce a provider outage, and verify recovery and
the absence of sensitive content in logs, traces, and error reporting.
