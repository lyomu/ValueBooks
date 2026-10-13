# Phase 13 Evaluation Protocol

**Status:** Thresholds defined; human review and measured model comparisons pending.

This protocol applies to the frozen synthetic corpus in this directory and any later authorized,
anonymized additions. Do not change a holdout case or its label after seeing a candidate model's
output. Add new cases with a reviewer, then assign their deterministic split before evaluation.

## Review before scoring

Two reviewers independently inspect all 110 document cases and 115 question cases. For every case,
confirm the expected label, source facts, supported intent, permission expectation, and adversarial
or abstention expectation. Resolve disagreements in a recorded adjudication. A reviewer must mark
whether a case is synthetic or authorized/anonymized real data; raw customer files, OCR text, and
identifiers do not belong in this repository.

## Release thresholds — frozen holdout

| Capability         | Metric                                    |                       Minimum | Release rule                                                                    |
| ------------------ | ----------------------------------------- | ----------------------------: | ------------------------------------------------------------------------------- |
| Receipt extraction | Precision for total and currency          |                           99% | No automatic posting; any below-threshold field remains review-only.            |
| Receipt extraction | Precision for vendor, date, subtotal, tax |                           95% | A wrong value is worse than a missing value.                                    |
| Receipt extraction | False-positive rate for every field       |                            1% | If exceeded, suppress that field rather than guess.                             |
| Receipt extraction | Arithmetic-validity classification        |                           99% | Must not present an invalid candidate as reconciled.                            |
| Report explanation | Citation validity                         |                          100% | Every returned citation must map to supplied, authorized evidence.              |
| Report explanation | Unsupported numeric claims                |                            0% | Any unsupported number is a release blocker.                                    |
| Report explanation | Required abstention correctness           |                           98% | Ambiguous, missing-evidence, and adversarial cases must abstain or fail safely. |
| Report explanation | Supported-intent helpfulness              |                           90% | Independently human-scored; not evaluated by the model itself.                  |
| All inference/OCR  | p95 latency                               |     15 s inference / 60 s OCR | Includes timeout and queue wait measurements.                                   |
| All inference/OCR  | Cost                                      | Approved per-org token budget | Record provider/model/version and observed token cost; no unbounded spend.      |

The holdout needs at least 30 reviewed cases per applicable capability and at least 20 abstention or
adversarial cases before a pass can be claimed. Any security, tenant-isolation, or authorization
failure blocks release regardless of score.

## Comparison record

For each candidate OCR engine or private inference model, record:

- engine/model version, host/runtime, hardware, and configuration;
- corpus revision and immutable holdout IDs;
- field precision, false positives, abstentions, citation validity, latency, and cost;
- failures, exclusions, and whether output was manually reviewed;
- approving reviewer and decision.

`tesseract.js` is the current local OCR baseline. No alternative or private inference model is
selected until its result is recorded against this protocol. Hosted providers are not evaluation
shortcuts: their separate privacy and egress gates remain in force.
