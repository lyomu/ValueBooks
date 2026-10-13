'use client';

import type { Contact } from '@valuebooks/contracts';
import { Button, Dialog, DialogContent, FieldMessage, Input, Label, Select } from '@valuebooks/ui';
import { MapPin, Save } from 'lucide-react';
import { useState, type ComponentProps, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';

type ContactResponse = { data: Contact };
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | null;
  baseCurrency: string;
  canOverrideCurrency: boolean;
  customer?: Contact | null;
  onSaved: (customer: Contact) => void;
  embedded?: boolean;
};

export function CustomerDialog({
  open,
  onOpenChange,
  organizationId,
  baseCurrency,
  canOverrideCurrency,
  customer,
  onSaved,
  embedded = false,
}: Props) {
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
        ? [{ label: formValue(data, 'taxIdLabel') || 'Tax ID', value: taxIdValue, countryCode }]
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
  const form = (
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
          <Field
            id="customer-display-name"
            label="Display name"
            name="displayName"
            value={customer?.displayName}
            placeholder="Customer or business name"
            required
            maxLength={160}
            wide
          />
          <Field
            id="customer-legal-name"
            label="Legal / company name"
            name="legalName"
            value={customer?.legalName}
            maxLength={200}
          />
          <Field
            id="customer-email"
            label="Email address"
            name="email"
            value={customer?.email}
            type="email"
          />
          <Field id="customer-phone" label="Phone" name="phone" value={customer?.phone} />
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
          <Field
            id="customer-terms"
            label="Payment terms (days)"
            name="paymentTermsDays"
            value={customer?.paymentTermsDays?.toString()}
            type="number"
            min={0}
            max={365}
          />
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
          <Field
            id="customer-tax-id-label"
            label="Tax ID label"
            name="taxIdLabel"
            value={taxId?.label ?? 'Tax ID'}
            maxLength={24}
          />
          <Field
            id="customer-tax-id-value"
            label="Tax ID"
            name="taxIdValue"
            value={taxId?.value}
            maxLength={60}
          />
          <Field
            id="customer-billing-line-1"
            label="Billing address"
            name="billingLine1"
            value={billingAddress?.line1}
            placeholder="Street address"
            maxLength={200}
            wide
          />
          <Field
            id="customer-billing-line-2"
            label="Address line 2"
            name="billingLine2"
            value={billingAddress?.line2}
            maxLength={200}
            wide
          />
          <Field
            id="customer-city"
            label="City"
            name="city"
            value={billingAddress?.city}
            maxLength={120}
          />
          <Field
            id="customer-region"
            label="Region / county"
            name="region"
            value={billingAddress?.region}
            maxLength={120}
          />
          <Field
            id="customer-postal-code"
            label="Postal code"
            name="postalCode"
            value={billingAddress?.postalCode}
            maxLength={32}
          />
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
          <Field
            id="customer-tags"
            label="Tags"
            name="tags"
            value={customer?.tags.join(', ')}
            placeholder="e.g. wholesale, priority"
            wide
          />
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
  );
  if (embedded) return <div className="rb-customer-editor">{form}</div>;
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
        {form}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  name,
  value,
  wide = false,
  ...input
}: { id: string; label: string; name: string; value?: string | null; wide?: boolean } & Omit<
  ComponentProps<typeof Input>,
  'id' | 'name' | 'value' | 'defaultValue'
>) {
  return (
    <div className={`rb-field${wide ? ' rb-customer-form__wide-field' : ''}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} defaultValue={value ?? ''} {...input} />
    </div>
  );
}
