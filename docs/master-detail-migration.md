# Master–detail migration boundary

The shared master–detail system is for record listings: a visitor can select one record, inspect a
read-only detail, and then use a permitted full-page edit route when that record is mutable.

## Intentionally excluded surfaces

- Dashboards and insights: these are aggregate decision surfaces, not record listings.
- Financial statements, trial balance, account-ledger reports, and report viewers: drill-downs are
  report navigation and may represent calculated balances rather than one mutable record.
- Inventory valuation and reorder advice: these are derived read models, not source records.
- Imports, onboarding, authentication, organization setup, and settings indexes: these are flows or
  configuration landing pages rather than a list of selectable domain records.
- Reconciliation's active workspace: it is a protected, in-progress task with its own selection
  state; its table action opens that workspace and is not a duplicate record-list "Open" action.

New record-oriented modules should use `RecordDetailWorkspace` (which delegates to
`MasterDetailLayout`) and one of `DocumentDetailView` or `EntityDetailView`. A module should not
create a module-specific split view.
