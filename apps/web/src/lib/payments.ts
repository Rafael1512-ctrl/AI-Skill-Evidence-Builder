import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  paymentCheckoutResponseSchema,
  paymentDetailResponseSchema,
  paymentListSchema,
  type PaymentTransaction,
} from '@aseb/shared';

import { apiRequest } from './api.js';
import { useAuth } from './auth.js';

export const PAYMENTS_PAGE_SIZE = 5;

/** The signed-in user's own top-up attempts, newest first. */
export function usePaymentsQuery(page = 1, pageSize = PAYMENTS_PAGE_SIZE) {
  const { token, status } = useAuth();

  return useQuery({
    queryKey: ['payments', token, page, pageSize],
    enabled: status === 'signed-in' && token !== null,
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiRequest(`/api/payments?page=${page}&pageSize=${pageSize}`, {
        token,
        schema: paymentListSchema,
      }),
  });
}

/**
 * Starts a top-up attempt.
 *
 * The API creates the PENDING row and asks the gateway for a payment instrument; the
 * client only displays the result. Credits appear after the gateway notification is
 * verified server-side, never because this mutation returned.
 */
export function useCreateTopUpMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<PaymentTransaction, Error, { packageId: string }>({
    mutationFn: async ({ packageId }) => {
      const response = await apiRequest('/api/payments/checkout', {
        method: 'POST',
        body: { packageId },
        token,
        schema: paymentCheckoutResponseSchema,
      });
      return response.payment;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}

/**
 * Development-only: settles an offline payment through the real webhook path.
 *
 * Refused by the API when a real provider is active or in production.
 */
export function useSimulateMockPaymentMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<PaymentTransaction, Error, { paymentId: string }>({
    mutationFn: async ({ paymentId }) => {
      const response = await apiRequest(`/api/payments/${paymentId}/simulate`, {
        method: 'POST',
        token,
        schema: paymentDetailResponseSchema,
      });
      return response.payment;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: ['credits', 'wallet'] }),
        queryClient.invalidateQueries({ queryKey: ['credits', 'transactions'] }),
      ]);
    },
  });
}
