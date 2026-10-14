# ValueBooks form design system

The application form system is owned by `@valuebooks/ui`. It is the source of truth for standard
field geometry, hierarchy, and searchable single-select behavior.

## Tokens

`packages/ui/src/tokens.css` defines the reusable field tokens:

- `--rb-field-height`: 42px
- `--rb-field-font-size`: 12px
- `--rb-field-label-size`: 12px at weight 600
- `--rb-field-radius`: 6px
- `--rb-field-padding-x`: 12px
- `--rb-field-value`, `--rb-field-placeholder`, and `--rb-field-label`: semantic foregrounds

Labels use the primary foreground. Values use the darker muted foreground rather than opacity, so
they remain sharp and accessible. Descriptions and errors use `FieldMessage` / `FormError`.

## Components

Use `FormField`, `FormLabel`, `FormInput`, `FormSelect`, `FormTextarea`, `FormDescription`, and
`FormError` for new composed fields. `Label`, `Input`, `Select`, `Textarea`, and `FieldMessage`
remain supported aliases for existing application forms.

Use `FormCombobox` for an in-form searchable single-select. It provides filtering, active-option
keyboard navigation, Enter selection, Escape dismissal, outside-pointer dismissal, focus
restoration after a keyboard dismissal/selection, and closes after a single selection. It stores
the selected value through an optional hidden `name` input for ordinary form submission.

`FormSearchInput`, `FormNumberInput`, and `FormDatePicker` are typed aliases of the shared input.
They preserve the common typography and focus treatment; compact table filters, global search,
transaction-line controls, OTP controls, file inputs, and large textareas intentionally retain
their documented layout variants.

## Migration rule

Do not add page-specific field typography, border, or dropdown dismissal handlers. Shared field
classes and the compatibility adapters for legacy `.rb-field`, platform administration, portal,
and dashboard fields apply the same tokens to existing forms; new work must use the components
above. Native selects retain their accessible native keyboard behavior and share the same geometry
and visual tokens. Checkboxes, radios, file pickers, OTP, global search, compact table filters,
transaction-line editors, and message composers are documented specialized controls rather than
standard form fields.
