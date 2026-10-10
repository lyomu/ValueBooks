'use client';

import type { Item, LedgerAccount, TaxCode, Unit, Vendor } from '@valuebooks/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  FieldMessage,
  Input,
  Label,
  Select,
  Textarea,
} from '@valuebooks/ui';
import { ImagePlus, Save } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';

type ItemResponse = { data: Item };
type ListResponse<T> = { data: T[] };

function itemPrice(item: Item | null | undefined, priceListKey: string, currency: string) {
  return item?.prices.find(
    (price) => price.priceListKey === priceListKey && price.currency === currency,
  );
}

function decimalPrice(item: Item | null | undefined, priceListKey: string, currency: string) {
  const price = itemPrice(item, priceListKey, currency);
  return price ? (Number(price.unitPriceMinor) / 100).toFixed(2) : '';
}

export function ItemDialog({
  open,
  onOpenChange,
  organizationId,
  currency,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | null;
  currency: string;
  item?: Item | null;
  onSaved: (item: Item) => void;
}) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [itemType, setItemType] = useState<Item['itemType']>(item?.itemType ?? 'GOODS');
  const [salesEnabled, setSalesEnabled] = useState(item?.salesEnabled ?? true);
  const [purchaseEnabled, setPurchaseEnabled] = useState(item?.purchaseEnabled ?? false);
  const [inventoryTracked, setInventoryTracked] = useState(item?.inventoryTracked ?? false);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(item?.imageDataUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !organizationId) return;
    void Promise.all([
      apiRequest<ListResponse<Unit>>(`/organizations/${organizationId}/catalog/units`),
      apiRequest<ListResponse<TaxCode>>(`/organizations/${organizationId}/tax/codes`),
      apiRequest<ListResponse<LedgerAccount>>(`/organizations/${organizationId}/accounts`),
      apiRequest<ListResponse<Vendor>>(`/organizations/${organizationId}/vendors?status=ACTIVE`),
    ])
      .then(([unitResponse, taxResponse, accountResponse, vendorResponse]) => {
        setUnits(unitResponse.data);
        setTaxCodes(taxResponse.data.filter((tax) => tax.status === 'ACTIVE'));
        setAccounts(accountResponse.data.filter((account) => account.status === 'ACTIVE'));
        setVendors(vendorResponse.data);
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error ? caught.message : 'Product form options could not be loaded.',
        );
      });
  }, [open, organizationId]);

  useEffect(() => {
    if (!open) return;
    setItemType(item?.itemType ?? 'GOODS');
    setSalesEnabled(item?.salesEnabled ?? true);
    setPurchaseEnabled(item?.purchaseEnabled ?? false);
    setInventoryTracked(item?.inventoryTracked ?? false);
    setImageDataUrl(item?.imageDataUrl ?? null);
    setError(null);
  }, [item, open]);

  const salesAccounts = useMemo(
    () => accounts.filter((account) => ['REVENUE', 'OTHER_INCOME'].includes(account.type)),
    [accounts],
  );
  const purchaseAccounts = useMemo(
    () => accounts.filter((account) => ['EXPENSE', 'COST_OF_SALES'].includes(account.type)),
    [accounts],
  );

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file for this product.');
      return;
    }
    if (file.size > 1_500_000) {
      setError('Choose an image smaller than 1.5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => setError('The product image could not be read.');
    reader.readAsDataURL(file);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;

    const data = new FormData(event.currentTarget);
    const salesPrice = formValue(data, 'salesPrice');
    const purchasePrice = formValue(data, 'purchasePrice');
    const body = {
      name: formValue(data, 'name'),
      sku: formValue(data, 'sku') || undefined,
      itemType,
      imageDataUrl: imageDataUrl ?? undefined,
      salesEnabled,
      salesDescription: formValue(data, 'salesDescription') || undefined,
      purchaseEnabled,
      purchaseDescription: formValue(data, 'purchaseDescription') || undefined,
      defaultUnitId: formValue(data, 'defaultUnitId') || undefined,
      revenueAccountId: salesEnabled ? formValue(data, 'revenueAccountId') || undefined : undefined,
      defaultTaxCodeId: salesEnabled ? formValue(data, 'defaultTaxCodeId') || undefined : undefined,
      purchaseAccountId: purchaseEnabled
        ? formValue(data, 'purchaseAccountId') || undefined
        : undefined,
      defaultPurchaseTaxCodeId: purchaseEnabled
        ? formValue(data, 'defaultPurchaseTaxCodeId') || undefined
        : undefined,
      preferredVendorId: purchaseEnabled
        ? formValue(data, 'preferredVendorId') || undefined
        : undefined,
      inventoryTracked: itemType === 'GOODS' && inventoryTracked,
      reorderThreshold:
        itemType === 'GOODS' && inventoryTracked
          ? formValue(data, 'reorderThreshold') || undefined
          : undefined,
      reorderQuantity:
        itemType === 'GOODS' && inventoryTracked
          ? formValue(data, 'reorderQuantity') || undefined
          : undefined,
      freeDescriptionAllowed: data.get('freeDescriptionAllowed') === 'on',
      prices: [
        ...(salesEnabled && salesPrice
          ? [
              {
                priceListKey: 'default',
                currency,
                unitPriceMinor: String(Math.round(Number(salesPrice) * 100)),
              },
            ]
          : []),
        ...(purchaseEnabled && purchasePrice
          ? [
              {
                priceListKey: 'purchase',
                currency,
                unitPriceMinor: String(Math.round(Number(purchasePrice) * 100)),
              },
            ]
          : []),
      ],
    };

    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<ItemResponse>(
        item
          ? `/organizations/${organizationId}/catalog/items/${item.id}`
          : `/organizations/${organizationId}/catalog/items`,
        { method: item ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      onSaved(response.data);
      onOpenChange(false);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The product or service could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  const isGoods = itemType === 'GOODS';
  const formKey = `${item?.id ?? 'new'}-${open ? 'open' : 'closed'}`;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent
        className="rb-item-dialog"
        title={item ? `Edit ${item.name}` : 'New product or service'}
        description="Set up the product, sales, purchase, and inventory defaults used throughout ValueBooks."
      >
        <form key={formKey} className="rb-item-form" onSubmit={(event) => void submit(event)}>
          {error ? (
            <div className="rb-auth-error" role="alert">
              {error}
            </div>
          ) : null}

          <section className="rb-item-form__section rb-item-form__overview">
            <div className="rb-item-form__fields">
              <div className="rb-field">
                <Label htmlFor="item-dialog-name">Name</Label>
                <Input
                  id="item-dialog-name"
                  name="name"
                  defaultValue={item?.name ?? ''}
                  required
                  maxLength={160}
                />
              </div>
              <fieldset className="rb-item-form__type">
                <legend>Type</legend>
                <label>
                  <input
                    type="radio"
                    name="itemType"
                    value="GOODS"
                    checked={itemType === 'GOODS'}
                    onChange={() => setItemType('GOODS')}
                  />{' '}
                  Goods
                </label>
                <label>
                  <input
                    type="radio"
                    name="itemType"
                    value="SERVICE"
                    checked={itemType === 'SERVICE'}
                    onChange={() => setItemType('SERVICE')}
                  />{' '}
                  Service
                </label>
                <label>
                  <input
                    type="radio"
                    name="itemType"
                    value="NON_STOCK"
                    checked={itemType === 'NON_STOCK'}
                    onChange={() => setItemType('NON_STOCK')}
                  />{' '}
                  Non-stock
                </label>
              </fieldset>
              <div className="rb-field">
                <Label htmlFor="item-dialog-unit">Unit</Label>
                <Select
                  id="item-dialog-unit"
                  name="defaultUnitId"
                  defaultValue={item?.defaultUnitId ?? ''}
                >
                  <option value="">Select a unit</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name} ({unit.code})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rb-field">
                <Label htmlFor="item-dialog-sku">SKU</Label>
                <Input
                  id="item-dialog-sku"
                  name="sku"
                  defaultValue={item?.sku ?? ''}
                  maxLength={60}
                />
              </div>
            </div>
            <label className="rb-item-form__image-picker">
              {imageDataUrl ? (
                // User-selected local file preview (data URL), not a remote/static asset --
                // unoptimized because Next's image optimizer can't fetch a data: URI, and the
                // existing CSS (width/height/object-fit) already controls the rendered size.
                <Image
                  src={imageDataUrl}
                  alt="Selected product"
                  width={800}
                  height={384}
                  unoptimized
                />
              ) : (
                <ImagePlus aria-hidden="true" />
              )}
              <span>{imageDataUrl ? 'Change product image' : 'Add product image'}</span>
              <small>PNG or JPG, up to 1.5 MB</small>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectImage} />
            </label>
          </section>

          <section className="rb-item-form__section">
            <label className="rb-item-form__section-toggle">
              <input
                type="checkbox"
                checked={salesEnabled}
                onChange={(event) => setSalesEnabled(event.target.checked)}
              />
              <span>Sales information</span>
            </label>
            {salesEnabled ? (
              <div className="rb-item-form__grid">
                <div className="rb-field">
                  <Label htmlFor="item-dialog-sales-price">Selling price ({currency})</Label>
                  <Input
                    id="item-dialog-sales-price"
                    name="salesPrice"
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={decimalPrice(item, 'default', currency)}
                    required
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-dialog-revenue-account">Sales account</Label>
                  <Select
                    id="item-dialog-revenue-account"
                    name="revenueAccountId"
                    defaultValue={item?.revenueAccountId ?? ''}
                  >
                    <option value="">Select an account</option>
                    {salesAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} · {account.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-dialog-sales-description">Sales description</Label>
                  <Textarea
                    id="item-dialog-sales-description"
                    name="salesDescription"
                    defaultValue={item?.salesDescription ?? ''}
                    placeholder="Shown as the default description on sales documents"
                    maxLength={2000}
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-dialog-sales-tax">Sales tax</Label>
                  <Select
                    id="item-dialog-sales-tax"
                    name="defaultTaxCodeId"
                    defaultValue={item?.defaultTaxCodeId ?? ''}
                  >
                    <option value="">No tax</option>
                    {taxCodes.map((tax) => (
                      <option key={tax.id} value={tax.id}>
                        {tax.code} · {tax.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            ) : null}
          </section>

          <section className="rb-item-form__section">
            <label className="rb-item-form__section-toggle">
              <input
                type="checkbox"
                checked={purchaseEnabled}
                onChange={(event) => setPurchaseEnabled(event.target.checked)}
              />
              <span>Purchase information</span>
            </label>
            {purchaseEnabled ? (
              <div className="rb-item-form__grid">
                <div className="rb-field">
                  <Label htmlFor="item-dialog-purchase-price">Cost price ({currency})</Label>
                  <Input
                    id="item-dialog-purchase-price"
                    name="purchasePrice"
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={decimalPrice(item, 'purchase', currency)}
                    required
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-dialog-purchase-account">Purchase account</Label>
                  <Select
                    id="item-dialog-purchase-account"
                    name="purchaseAccountId"
                    defaultValue={item?.purchaseAccountId ?? ''}
                  >
                    <option value="">Select an account</option>
                    {purchaseAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} · {account.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-dialog-purchase-description">Purchase description</Label>
                  <Textarea
                    id="item-dialog-purchase-description"
                    name="purchaseDescription"
                    defaultValue={item?.purchaseDescription ?? ''}
                    placeholder="Shown as the default description on purchase documents"
                    maxLength={2000}
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-dialog-purchase-tax">Purchase tax</Label>
                  <Select
                    id="item-dialog-purchase-tax"
                    name="defaultPurchaseTaxCodeId"
                    defaultValue={item?.defaultPurchaseTaxCodeId ?? ''}
                  >
                    <option value="">No tax</option>
                    {taxCodes.map((tax) => (
                      <option key={tax.id} value={tax.id}>
                        {tax.code} · {tax.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-dialog-vendor">Preferred vendor</Label>
                  <Select
                    id="item-dialog-vendor"
                    name="preferredVendorId"
                    defaultValue={item?.preferredVendorId ?? ''}
                  >
                    <option value="">Select a vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.displayName}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            ) : null}
          </section>

          <section className="rb-item-form__section">
            <label className="rb-item-form__section-toggle">
              <input
                type="checkbox"
                checked={inventoryTracked}
                disabled={!isGoods}
                onChange={(event) => setInventoryTracked(event.target.checked)}
              />
              <span>Track inventory for this item</span>
            </label>
            {!isGoods ? (
              <FieldMessage>Inventory tracking is available for goods only.</FieldMessage>
            ) : null}
            {isGoods && inventoryTracked ? (
              <div className="rb-item-form__grid rb-item-form__inventory-grid">
                <div className="rb-field">
                  <Label htmlFor="item-dialog-reorder-threshold">Reorder point</Label>
                  <Input
                    id="item-dialog-reorder-threshold"
                    name="reorderThreshold"
                    inputMode="decimal"
                    defaultValue={item?.reorderThreshold ?? ''}
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-dialog-reorder-quantity">Reorder quantity</Label>
                  <Input
                    id="item-dialog-reorder-quantity"
                    name="reorderQuantity"
                    inputMode="decimal"
                    defaultValue={item?.reorderQuantity ?? ''}
                  />
                </div>
              </div>
            ) : null}
            <label className="rb-item-form__sub-toggle">
              <input
                type="checkbox"
                name="freeDescriptionAllowed"
                defaultChecked={item?.freeDescriptionAllowed ?? true}
              />{' '}
              Allow a free-text description on invoice lines
            </label>
          </section>

          <footer className="rb-item-form__footer">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <Save aria-hidden="true" /> {item ? 'Save changes' : 'Save product or service'}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
