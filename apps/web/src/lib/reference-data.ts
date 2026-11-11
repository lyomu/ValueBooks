'use client';

import type { CurrencySettings, OrganizationReferenceData } from '@valuebooks/contracts';
import type { CurrencyOption } from '@valuebooks/ui';
import { useEffect, useState } from 'react';

import { apiRequest } from './api';

let referenceDataPromise: Promise<OrganizationReferenceData> | null = null;

function loadReferenceData(): Promise<OrganizationReferenceData> {
  if (!referenceDataPromise) {
    referenceDataPromise = apiRequest<{ data: OrganizationReferenceData }>(
      '/organizations/reference-data',
    )
      .then((response) => response.data)
      .catch((error: unknown) => {
        // Do not cache failures; the next mount retries.
        referenceDataPromise = null;
        throw error;
      });
  }
  return referenceDataPromise;
}

/** Country list and defaults shared by every form. Fetched once per page load. */
export function useReferenceData(): OrganizationReferenceData | null {
  const [data, setData] = useState<OrganizationReferenceData | null>(null);
  useEffect(() => {
    let active = true;
    loadReferenceData()
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return data;
}

/**
 * Currencies the organization has enabled, for `CurrencySelect`. Until the list loads (or if it
 * cannot) the fallback currency is the only option so forms always have a valid value.
 */
export function useOrganizationCurrencies(
  organizationId: string | null | undefined,
  fallbackCurrency?: string,
): CurrencyOption[] {
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    apiRequest<{ data: CurrencySettings }>(`/organizations/${organizationId}/currencies`)
      .then((response) => {
        if (!active) return;
        setCurrencies(
          response.data.currencies
            .filter((currency) => currency.enabled)
            .map((currency) => ({
              code: currency.code,
              name: currency.name,
              symbol: currency.symbol,
              minorUnits: currency.minorUnits,
            })),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [organizationId]);

  if (currencies.length === 0 && fallbackCurrency) {
    return [{ code: fallbackCurrency, name: fallbackCurrency, symbol: fallbackCurrency }];
  }
  return currencies;
}
