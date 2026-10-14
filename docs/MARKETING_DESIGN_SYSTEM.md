# Public Marketing Design System

The public website is scoped beneath `.mk-root`; its typography does not alter the authenticated
ValueBooks application.

## Type roles

| Role                           | Desktop |        Weight | Line height | Tracking                     |
| ------------------------------ | ------: | ------------: | ----------: | ---------------------------- |
| Inner-page hero heading        |    48px |           700 |        1.12 | 0.01em                       |
| Inner-page hero description    |    16px |           400 |         1.6 | normal                       |
| Section heading                |    30px |           700 |         1.2 | 0.01em                       |
| Eyebrow                        |  13.5px |           600 |   inherited | existing uppercase treatment |
| Navigation and buttons         |    14px | 400–500 / 700 |        1.35 | normal                       |
| Body                           |    14px |           400 |         1.6 | normal                       |
| Mega-menu item and description |    12px |           400 |        1.45 | normal                       |
| Footer body                    |    12px |           400 |         1.6 | normal                       |
| Footer legal and copyright     |    10px |           400 |         1.5 | normal                       |

The responsive inner-page hero scale is 48px desktop, 40px tablet, and 32px mobile.

## Shared components

- `PageHero` is the sole text-only inner-page hero: title and description only.
- `SiteHeader` and its Product/Industries mega menus use the same navigation and menu tokens.
- `SiteFooter` owns public-footer typography and legal-link behavior.
- `.mk-button` defines public CTA typography. Pricing-card buttons preserve their pre-existing
  typography and remain outside this system change.

## Guardrails

- Marketing CSS lives in `apps/web/src/app/(marketing)/` and is scoped to `.mk-root`.
- Pricing tables, plan cards, amounts, comparisons, and billing controls are not changed by the
  marketing typography rules.
- The authenticated application continues to use `apps/web/src/app/styles.css` and shared UI
  tokens independently.
