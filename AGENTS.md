# Development conventions

## Design System First

Before implementing new UI, inspect the existing ValueBooks component library, layouts,
typography, design tokens, and interaction patterns. Reuse suitable components first. Extend
existing components through reusable variants when necessary. Create new components only when an
appropriate equivalent does not exist. Do not duplicate styling, introduce arbitrary design
tokens, or build isolated page-specific UI patterns without justification. Respect the distinct
design contexts of the public marketing site, authenticated application, and Platform Admin
Portal.

This applies to the public marketing website, authentication, onboarding, the customer
application, the Platform Admin Portal, billing and subscription management, and all future
ValueBooks modules.

Required order when implementing new UI:

1. **Inspect** — identify whether a suitable component, layout, design token, or styling pattern
   already exists (e.g. `packages/ui`, `apps/web/src/app/(marketing)/marketing.css`,
   `apps/web/src/app/(marketing)/marketing-additions.css`, `apps/web/src/app/styles.css`).
2. **Reuse** — if an appropriate shared component exists, use it without creating a duplicate.
3. **Extend** — if an existing component almost meets the requirement, extend it through a
   documented reusable variant. Do not introduce page-specific modifications that unexpectedly
   affect other consumers.
4. **Create** — only create a new component when the required functionality or design cannot
   reasonably be achieved through the existing system.
5. **Standardize** — if a new reusable component is necessary, place it in the appropriate shared
   component library, follow existing naming conventions, use existing typography/color/spacing
   tokens, implement responsive behavior, support accessibility, and document its intended usage.

Do not introduce a new design system or styling convention for a single feature or page.

Design consistency does not mean forcing every interface to have identical typography or layout:
the public marketing site, the authenticated accounting application, and the Platform Admin
Portal are distinct design contexts that share foundational tokens and components where
appropriate, but marketing-specific typography and animation should not be forced onto financial
tables, application forms, or generated documents.
