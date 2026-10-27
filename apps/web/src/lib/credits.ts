import { keepPreviousData, useQuery } from '@tanstack/react-query';

import {
  creditTransactionListSchema,
  creditWalletSchema,
  featurePricingListSchema,
  topUpPackageListSchema,
} from '@aseb/shared';

import { apiRequest } from './api.js';
import { useAuth } from './auth.js';

/** Public price list. Served from shared defaults plus any admin override. */
export function usePricingQuery() {
  return useQuery({
    queryKey: ['credits', 'pricing'],
    queryFn: () => apiRequest('/api/credits/pricing', { schema: featurePricingListSchema }),
  });
}

export function useTopUpPackagesQuery() {
  return useQuery({
    queryKey: ['credits', 'packages'],
    // A constant list: no reason to refetch it during a session.
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => apiRequest('/api/credits/packages', { schema: topUpPackageListSchema }),
  });
}

export function useWalletQuery() {
  const { token, status } = useAuth();

  return useQuery({
    queryKey: ['credits', 'wallet', token],
    enabled: status === 'signed-in' && token !== null,
    queryFn: () => apiRequest('/api/credits/wallet', { token, schema: creditWalletSchema }),
  });
}

export function useCreditTransactionsQuery(page: number, pageSize = 20) {
  const { token, status } = useAuth();

  return useQuery({
    queryKey: ['credits', 'transactions', token, page, pageSize],
    enabled: status === 'signed-in' && token !== null,
    // Keeps the previous page visible while the next one loads.
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiRequest(`/api/credits/transactions?page=${page}&pageSize=${pageSize}`, {
        token,
        schema: creditTransactionListSchema,
      }),
  });
}
