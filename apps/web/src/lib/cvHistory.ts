import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cvHistoryResponseSchema, type CvHistoryResponse } from '@aseb/shared';

import { apiRequest, apiRequestNoContent } from './api.js';
import { useAuth } from './auth.js';

export function cvHistoryQueryKey(token: string | null) {
  return ['cv-history', token] as const;
}

/** Stored audits and enhancements for the signed-in job seeker. */
export function useCvHistoryQuery() {
  const { token, status } = useAuth();

  return useQuery<CvHistoryResponse>({
    queryKey: cvHistoryQueryKey(token),
    enabled: status === 'signed-in' && token !== null,
    queryFn: () =>
      apiRequest('/api/cv/history?page=1&pageSize=20', {
        token,
        schema: cvHistoryResponseSchema,
      }),
  });
}

/** Deletes the stored source CV and cascades its analyses. */
export function useDeleteCvDocumentMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (documentId) =>
      apiRequestNoContent(`/api/cv/documents/${documentId}`, {
        method: 'DELETE',
        token,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cvHistoryQueryKey(token) });
    },
  });
}
