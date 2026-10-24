# Runbook: rolling back a country pack version

**Who:** Superadmin (publish and deprecate both require it). Reason required.
**Console:** Platform configuration → Country & tax → pack → version page.

## Rules that limit what a rollback can do

- Published versions are **immutable**. Only drafts can be edited, published or deleted.
- New organizations get the **current** version of their country's pack: the `PUBLISHED` version with the latest
  `publishedAt`.
- Each organization keeps the version it was **pinned** to at setup. Issued documents and posted entries keep the
  tax they were issued with. **No action here changes existing organizations, documents or posted accounting.**
- A deprecated version cannot be published again. Only drafts can be published.

## Roll back a bad version

1. On the bad version's page, note **Organizations pinned** to it. These are tenants created while it was current.
2. **Deprecate** it (reason, plus the impact statement). The previous published version, if it is still published,
   becomes current again for new organizations at once. The version page shows which version new organizations get.
3. If no earlier version is still published, or the earlier one is also wrong: on a good version, **Create version
   from this**, correct the draft, review it, and **Publish** it. Type the identifier back to confirm.
4. **Tier A (reviewed) packs:** a deprecated Tier A version no longer counts as reviewed for organizations pinned to
   it. Tell the owner.

## Organizations pinned to the bad version

There is no console tool to re-pin an organization, and none should be improvised. List the pinned organizations
from the version page and give the list to the owner. Moving a tenant to another pack version affects how their
future documents are taxed, so it needs the owner's decision and a reviewed migration.

## Do not

- Edit `country_packs` or `tax_packs` rows in the database.
- Delete a published version. Only drafts can be deleted, and the API refuses the rest.

## Check

Operations & trust → Audit logs, filtered to *Country pack deprecated* or *Country pack published*: the reason and
the before/after state.
