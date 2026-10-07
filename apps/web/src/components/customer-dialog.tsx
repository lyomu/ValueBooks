'use client';

import type { Contact } from '@valuebooks/contracts';
import { Button, Dialog, DialogContent, FieldMessage, Input, Label, Select } from '@valuebooks/ui';
import { MapPin, Save } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';

type ContactResponse = { data: Contact };

export function CustomerDialog({
  open,
  onOpenChange,
  organizationId,
  baseCurrency,
  canOverrideCurrency,
  customer,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | null;
  baseCurrency: string;
  canOverrideCurrency: boolean;
  customer?: Contact | null;
  onSaved: (customer: Contact) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const billingAddress = customer?.addresses.find((address) => address.kind === 'BILLING');
  const taxId = customer?.taxIds[0];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;

    const data = new FormData(event.currentTarget);
    const tags = formValue(data, 'tags');
    const addressLine = formValue(data, 'billingLine1');
    const taxIdValue = formValue(data, 'taxIdValue');
    const countryCode = formValue(data, 'countryCode') || 'KE';
    const body = {
      displayName: formValue(data, 'displayName'),
      legalName: formValue(data, 'legalName') || undefined,
      email: formValue(data, 'email') || undefined,
      phone: formValue(data, 'phone') || undefined,
      currency: canOverrideCurrency ? formValue(data, 'currency') || undefined : undefined,
      paymentTermsDays: formValue(data, 'paymentTermsDays')
        ? Number(formValue(data, 'paymentTermsDays'))
        : undefined,
      tags: tags
        ? tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
        : undefined,
      addresses: addressLine
        ? [
            {
              kind: 'BILLING',
              line1: addressLine,
              line2: formValue(data, 'billingLine2') || undefined,
              city: formValue(data, 'city') || undefined,
              region: formValue(data, 'region') || undefined,
              postalCode: formValue(data, 'postalCode') || undefined,
              countryCode,
              isDefault: true,
            },
          ]
        : undefined,
      taxIds: taxIdValue
        ? [
            {
              label: formValue(data, 'taxIdLabel') || 'Tax ID',
              value: taxIdValue,
              countryCode,
            },
          ]
        : undefined,
    };

    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<ContactResponse>(
        customer
          ? `/organizations/${organizationId}/customers/${customer.id}`
          : `/organizations/${organizationId}/customers`,
        { method: customer ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      onSaved(response.data);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The customer could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="rb-customer-dialog"
        title={customer ? `Edit ${customer.displayName}` : 'New customer'}
        description="Create a customer record with the billing details you need for invoices."
      >
        <form className="rb-customer-form" onSubmit={(event) => void submit(event)}>
          {error ? (
            <div className="rb-auth-error" role="alert">
              {error}
            </div>
          ) : null}

          <section className="rb-customer-form__section" aria-labelledby="customer-core-details">
            <div className="rb-customer-form__section-heading">
              <div>
                <h2 id="customer-core-details">Customer details</h2>
                <p>Use the display name on invoices and customer-facing documents.</p>
              </div>
              <span>Customer</span>
            </div>
            <div className="rb-customer-form__grid">
              <div className="rb-field rb-customer-form__wide-field">
                <Label htmlFor="customer-display-name">Display name</Label>
                <Input
                  id="customer-display-name"
                  name="displayName"
                  defaultValue={customer?.displayName ?? ''}
                  placeholder="Customer or business name"
                  required
                  maxLength={160}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="customer-legal-name">Legal / company name</Label>
                <Input
                  id="customer-legal-name"
                  name="legalName"
                  defaultValue={customer?.legalName ?? ''}
                  maxLength={200}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="customer-email">Email address</Label>
                <Input
                  id="customer-email"
                  name="email"
                  type="email"
                  defaultValue={customer?.email ?? ''}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="customer-phone">Phone</Label>
                <Input id="customer-phone" name="phone" defaultValue={customer?.phone ?? ''} />
              </div>
              <div className="rb-field">
                <Label htmlFor="customer-currency">Invoice currency</Label>
                <Input
                  id="customer-currency"
                  name="currency"
                  defaultValue={customer?.currency ?? baseCurrency}
                  disabled={!canOverrideCurrency}
                  maxLength={3}
                />
                {!canOverrideCurrency ? (
                  <FieldMessage>Uses your organization’s base currency.</FieldMessage>
                ) : null}
              </div>
              <div className="rb-field">
                <Label htmlFor="customer-terms">Payment terms</Label>
                <div className="rb-customer-form__terms-field">
                  <Input
                    id="customer-terms"
                    name="paymentTermsDays"
                    type="number"
                    min={0}
                    max={365}
                    defaultValue={customer?.paymentTermsDays ?? ''}
                    placeholder="0"
                  />
                  <span>days</span>
                </div>
              </div>
            </div>
          </section>

          <section className="rb-customer-form__section" aria-labelledby="customer-billing-details">
            <div className="rb-customer-form__section-heading">
              <div>
                <h2 id="customer-billing-details">Billing, tax &amp; address</h2>
                <p>These details stay with the customer and can be reused for future invoices.</p>
              </div>
              <MapPin aria-hidden="true" />
            </div>
            <div className="rb-customer-form__grid">
              <div className="rb-field">
                <Label htmlFor="customer-tax-id-label">Tax ID label</Label>
                <Input
                  id="customer-tax-id-label"
                  name="taxIdLabel"
                  defaultValue={taxId?.label ?? 'Tax ID'}
                  maxLength={24}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="customer-tax-id-value">Tax ID</Label>
                <Input
                  id="customer-tax-id-value"
                  name="taxIdValue"
                  defaultValue={taxId?.value ?? ''}
                  maxLength={60}
                />
              </div>
              <div className="rb-field rb-customer-form__wide-field">
                <Label htmlFor="customer-billing-line-1">Billing address</Label>
                <Input
                  id="customer-billing-line-1"
                  name="billingLine1"
                  defaultValue={billingAddress?.line1 ?? ''}
                  placeholder="Street address"
                  maxLength={200}
                />
              </div>
              <div className="rb-field rb-customer-form__wide-field">
                <Label htmlFor="customer-billing-line-2">Address line 2</Label>
                <Input
                  id="customer-billing-line-2"
                  name="billingLine2"
                  defaultValue={billingAddress?.line2 ?? ''}
                  maxLength={200}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="customer-city">City</Label>
                <Input
                  id="customer-city"
                  name="city"
                  defaultValue={billingAddress?.city ?? ''}
                  maxLength={120}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="customer-region">Region / county</Label>
                <Input
                  id="customer-region"
                  name="region"
                  defaultValue={billingAddress?.region ?? ''}
                  maxLength={120}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="customer-postal-code">Postal code</Label>
                <Input
                  id="customer-postal-code"
                  name="postalCode"
                  defaultValue={billingAddress?.postalCode ?? ''}
                  maxLength={32}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="customer-country-code">Country</Label>
                <Select
                  id="customer-country-code"
                  name="countryCode"
                  defaultValue={billingAddress?.countryCode ?? taxId?.countryCode ?? 'KE'}
                >
                  <option value="KE">Kenya</option>
                  <option value="UG">Uganda</option>
                  <option value="TZ">Tanzania</option>
                  <option value="RW">Rwanda</option>
                  <option value="GB">United Kingdom</option>
                  <option value="US">United States</option>
                </Select>
              </div>
              <div className="rb-field rb-customer-form__wide-field">
                <Label htmlFor="customer-tags">Tags</Label>
                <Input
                  id="customer-tags"
                  name="tags"
                  defaultValue={customer?.tags.join(', ') ?? ''}
                  placeholder="e.g. wholesale, priority"
                />
              </div>
            </div>
          </section>

          <footer className="rb-customer-form__footer">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <Save aria-hidden="true" /> {customer ? 'Save changes' : 'Save customer'}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
