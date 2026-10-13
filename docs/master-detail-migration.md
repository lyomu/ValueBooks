# Master–detail migration boundary

The shared master–detail system is for record listings: a visitor can select one record, inspect a
read-only detail, and then use a permitted full-page edit route when that record is mutable.

## Intentionally excluded surfaces

- Dashboards and insights: these are aggregate decision surfaces, not record listings.
- Financial statements, trial balance, account-ledger reports, and report viewers: drill-downs are
  report navigation and may represent calculated balances rather than one mutable record. The
  chart of accounts falls in this group too — its "Open" action goes to a full-page account ledger
  report, not a selectable record detail.
- Inventory valuation and reorder advice: these are derived read models, not source records.
- Imports, onboarding, authentication, organization setup, and settings indexes: these are flows or
  configuration landing pages rather than a list of selectable domain records.
- Reconciliation's active workspace: it is a protected, in-progress task with its own selection
  state; its table action opens that workspace and is not a duplicate record-list "Open" action.
- Bank transactions: each row is an unresolved statement line worked through a
  categorize/match/exclude action panel, the same "protected in-progress task" shape as
  reconciliation, not a record with a stable read-only detail.
- Inventory transfers: the page is a single creation form with no listing of past transfers to
  select from (transfer history is read back through Stock Movements, which is already migrated).
- Approvals: requests are reviewed through an inbox/submitted-by-me queue pair plus a policies tab,
  opened in an action dialog (`RequestDetailPanel`) that drives approve/reject, not a browsable
  list with a canonical "view this record" detail. Converting it would have to either demote the
  approve/reject action flow or duplicate it alongside a read-only rail, so it stays a queue.
- Workflow rules and bank rules: these are configuration (trigger/condition/action definitions),
  not domain records a user looks up by reference.
- Audit logs (`/settings/audit-log`, `/platform/audit`): append-only chronological event streams.
  There is nothing to mutate and no full-page edit to gate, so a rail+detail split adds UI
  without adding capability.
- Projects: `ProjectDetailPage` is a multi-section workbench (tasks, budgets, time, linked
  expenses, a billing/invoice-generation pipeline) layered on one record, not a flat list of
  interchangeable records with one read-only/editable shape. Forcing it into the rail model would
  mean relocating unrelated subsystems (task management, budget allocation, invoice generation)
  into a detail pane sized for a single record summary, which is a net regression for that page.
  The projects _register_ (`ProjectsPage`) is a plain list; it still opens the full project page
  via `/projects/[id]` rather than a rail, for the same reason.

## Migrated this phase

- Recurring journal templates (`RecurringJournalsPage`, the "Recurring" tab on `/journals`): the
  previously inline template list now opens into `RecordDetailWorkspace` with the selection held in
  `?tab=recurring&template=<id>`, so the tab and the record both survive refresh/back-forward.
  Templates have no field-level edit flow (only create, deactivate/reactivate, and the global "run
  due now" sweep survive this session), so the detail is read-only with those actions in the
  header — there is no full-page edit route because there is nothing yet to edit.
- Transfers (`TransfersPage`): list rows now link to a canonical `/transfers/[id]`, mirroring the
  vendors/customers pattern (`initialSelectedTransferId` seeds selection from the route, the list
  itself resolves the record). Void is preserved as a header action on `POSTED` transfers only,
  matching the existing immutability rule. There is no edit route: transfers have no mutate-in-place
  API, only void, so a full-page editor would imply a capability the backend doesn't offer.

New record-oriented modules should use `RecordDetailWorkspace` (which delegates to
`MasterDetailLayout`) and one of `DocumentDetailView` or `EntityDetailView`. A module should not
create a module-specific split view.
