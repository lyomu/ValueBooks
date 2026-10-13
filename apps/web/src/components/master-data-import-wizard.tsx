'use client';

import {
  Button,
  Card,
  DataTable,
  Dialog,
  DialogContent,
  FieldMessage,
  Label,
  Select,
} from '@valuebooks/ui';
import { Download, FileUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ApiError, apiUpload } from '../lib/api';

type Kind = 'customers' | 'vendors' | 'items';
type Row = {
  rowNumber: number;
  action: 'CREATE' | 'UPDATE' | 'SKIP' | 'IMPORT_ANYWAY' | 'INVALID';
  errors: string[];
  match?: { id: string; displayName: string; matchedOn: string };
};
type Result = {
  kind: Kind;
  dryRun: boolean;
  totalRows: number;
  createCount: number;
  updateCount: number;
  skipCount: number;
  invalidCount: number;
  rows: Row[];
};

const fields: Record<Kind, readonly string[]> = {
  customers: [
    'displayName',
    'legalName',
    'email',
    'phone',
    'currency',
    'paymentTermsDays',
    'receivableAccountId',
    'tags',
    'addresses',
    'taxIds',
  ],
  vendors: [
    'displayName',
    'legalName',
    'email',
    'phone',
    'currency',
    'paymentTermsDays',
    'payableAccountId',
    'tags',
    'addresses',
    'taxIds',
  ],
  items: [
    'sku',
    'name',
    'itemType',
    'imageDataUrl',
    'salesEnabled',
    'salesDescription',
    'purchaseEnabled',
    'purchaseDescription',
    'categoryId',
    'defaultUnitId',
    'revenueAccountId',
    'purchaseAccountId',
    'defaultTaxCodeId',
    'inventoryTracked',
    'defaultPurchaseTaxCodeId',
    'reorderThreshold',
    'reorderQuantity',
    'preferredVendorId',
    'freeDescriptionAllowed',
    'prices',
  ],
};

export function downloadMasterDataTemplate(kind: Kind) {
  const text = `${fields[kind].join(',')}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${kind}-import-template.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function MasterDataImportWizard({
  kind,
  organizationId,
  file,
  onClose,
  onCommitted,
}: {
  kind: Kind;
  organizationId: string;
  file: File | null;
  onClose: () => void;
  onCommitted: (result: Result) => void;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [rowActions, setRowActions] = useState<Record<string, Row['action']>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!file) return;
    void file.text().then((text) => {
      const parsed =
        text
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/, 1)[0]
          ?.split(',')
          .map((header) => header.trim())
          .filter(Boolean) ?? [];
      setHeaders(parsed);
      setMapping(
        Object.fromEntries(
          fields[kind].filter((field) => parsed.includes(field)).map((field) => [field, field]),
        ),
      );
      setResult(null);
      setRowActions({});
    });
  }, [file, kind]);
  const actions = useMemo(() => {
    const defaults = Object.fromEntries(
      (result?.rows ?? []).map((row) => [row.rowNumber, row.action]),
    );
    return { ...defaults, ...rowActions };
  }, [result, rowActions]);
  async function preview(commit = false) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiUpload<{ data: Result }>(
        `/organizations/${organizationId}/${kind === 'items' ? 'catalog' : kind}/import`,
        file,
        {
          mapping: JSON.stringify(mapping),
          actions: JSON.stringify(actions),
          dryRun: String(!commit),
        },
        commit ? { 'Idempotency-Key': crypto.randomUUID() } : {},
      );
      setResult(response.data);
      if (!commit) {
        setRowActions(
          Object.fromEntries(response.data.rows.map((row) => [row.rowNumber, row.action])),
        );
      }
      if (commit) onCommitted(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The import could not be processed.');
    } finally {
      setBusy(false);
    }
  }
  const previewRows = result?.rows.map((row) => ({ ...row, id: String(row.rowNumber) })) ?? [];
  return (
    <Dialog
      open={Boolean(file)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={`Import ${kind}`}
        description="Map columns, validate every row, then commit the valid choices."
      >
        <div className="rb-ledger-stack">
          {error ? <FieldMessage error>{error}</FieldMessage> : null}
          <Button type="button" variant="outline" onClick={() => downloadMasterDataTemplate(kind)}>
            <Download aria-hidden="true" /> Download template
          </Button>
          {!result ? (
            <Card className="rb-ledger-form-card">
              <div className="rb-ledger-form__heading">
                <div>
                  <h2>Map columns</h2>
                  <p>
                    Nested addresses, tax IDs, and prices use JSON cells; related records use
                    organization UUIDs.
                  </p>
                </div>
              </div>
              <div className="rb-field-grid">
                {fields[kind].map((field) => (
                  <div className="rb-field" key={field}>
                    <Label htmlFor={`map-${field}`}>{field}</Label>
                    <Select
                      id={`map-${field}`}
                      value={mapping[field] ?? ''}
                      onChange={(event) =>
                        setMapping((current) => ({ ...current, [field]: event.target.value }))
                      }
                    >
                      <option value="">Do not import</option>
                      {headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
              <Button type="button" disabled={busy || !file} onClick={() => void preview()}>
                <FileUp aria-hidden="true" /> {busy ? 'Validating…' : 'Preview import'}
              </Button>
            </Card>
          ) : (
            <>
              <Card className="rb-ledger-form-card">
                <h2>Preview</h2>
                <p>
                  {result.createCount} create · {result.updateCount} update · {result.skipCount}{' '}
                  skip · {result.invalidCount} invalid
                </p>
                <Button
                  type="button"
                  disabled={busy || result.createCount + result.updateCount === 0}
                  onClick={() => void preview(true)}
                >
                  {busy ? 'Importing…' : 'Commit valid rows'}
                </Button>
              </Card>
              <DataTable
                caption="Import preview"
                rows={previewRows}
                columns={[
                  { key: 'row', header: 'Row', cell: (row) => row.rowNumber },
                  {
                    key: 'action',
                    header: 'Action',
                    cell: (row) =>
                      row.action === 'INVALID' ? (
                        'Invalid'
                      ) : (
                        <Select
                          aria-label={`Action for row ${row.rowNumber}`}
                          value={actions[row.rowNumber] ?? row.action}
                          onChange={(event) =>
                            setRowActions((current) => ({
                              ...current,
                              [row.rowNumber]: event.target.value as Row['action'],
                            }))
                          }
                        >
                          <option value="CREATE" disabled={Boolean(row.match)}>
                            Create
                          </option>
                          <option value="UPDATE" disabled={!row.match || kind === 'vendors'}>
                            Update matched record
                          </option>
                          <option value="SKIP">Skip</option>
                          {kind === 'vendors' ? (
                            <option value="IMPORT_ANYWAY">Import anyway</option>
                          ) : null}
                        </Select>
                      ),
                  },
                  { key: 'match', header: 'Match', cell: (row) => row.match?.displayName ?? '—' },
                  { key: 'errors', header: 'Errors', cell: (row) => row.errors.join(' ') || '—' },
                ]}
                emptyTitle="No rows"
                emptyDescription="Upload a CSV with data rows."
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
