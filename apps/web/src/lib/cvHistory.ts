import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cvAnalysisDetailSchema,
  cvEnhancementResponseSchema,
  cvHistoryResponseSchema,
  type CvHistoryResponse,
} from '@aseb/shared';

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

/**
 * One page of the account's stored audits and enhancements, newest first.
 *
 * The key extends `cvHistoryQueryKey`, so every invalidation of the history reaches it, and
 * it carries the token, so one account never sees another account's cached rows.
 */
export function useCvHistoryPageQuery(page: number, pageSize: number) {
  const { token, status } = useAuth();

  return useQuery({
    queryKey: [...cvHistoryQueryKey(token), 'page', page, pageSize],
    enabled: status === 'signed-in' && token !== null,
    // Keeps the previous page visible while the next one loads.
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiRequest(`/api/cv/history?page=${page}&pageSize=${pageSize}`, {
        token,
        schema: cvHistoryResponseSchema,
      }),
  });
}

/** One stored audit with its full result. The API answers 404 unless the account owns it. */
export function useAuditDetailQuery(analysisId: string) {
  const { token, status } = useAuth();

  return useQuery({
    queryKey: ['cv-audit-detail', token, analysisId],
    enabled: status === 'signed-in' && token !== null,
    // A stored result never changes.
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () =>
      apiRequest(`/api/cv/analyses/${encodeURIComponent(analysisId)}`, {
        token,
        schema: cvAnalysisDetailSchema,
      }),
  });
}

/**
 * One stored enhancement. The API answers 404 unless the account owns it.
 *
 * Unlike an audit it can change: deleting the source CV clears its text, so the key extends
 * `cvHistoryQueryKey` to be refreshed with the rest of the history.
 */
export function useEnhancementDetailQuery(enhancementId: string) {
  const { token, status } = useAuth();

  return useQuery({
    queryKey: [...cvHistoryQueryKey(token), 'enhancement', enhancementId],
    enabled: status === 'signed-in' && token !== null,
    queryFn: async () => {
      const response = await apiRequest(
        `/api/cv/enhancements/${encodeURIComponent(enhancementId)}`,
        { token, schema: cvEnhancementResponseSchema },
      );
      return response.enhancement;
    },
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
