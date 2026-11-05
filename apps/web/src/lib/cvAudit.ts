import { useEffect } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cvAuditJobResponseSchema,
  cvAuditUsageSchema,
  type CvAuditJob,
  type CvAuditUsage,
} from '@aseb/shared';

import { apiRequest, apiUpload } from './api.js';
import { useAuth } from './auth.js';
import { cvHistoryQueryKey } from './cvHistory.js';

export function auditUsageQueryKey(token: string | null) {
  return ['cv-audit-usage', token] as const;
}

export function auditJobQueryKey(token: string | null, auditId: string | null) {
  return ['cv-audit-job', token, auditId] as const;
}

/** Free quota and the effective additional-audit price for the signed-in account. */
export function useAuditUsageQuery() {
  const { token } = useAuth();

  return useQuery<CvAuditUsage>({
    queryKey: auditUsageQueryKey(token),
    enabled: token !== null,
    queryFn: () => apiRequest('/api/cv/audit/usage', { token, schema: cvAuditUsageSchema }),
  });
}

/**
 * Submits a CV for audit.
 *
 * The API requires a session. The first five audits per Jakarta calendar day are free;
 * after that it reserves and settles the configured additional-audit price.
 */
export function useAuditCvMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<CvAuditJob, Error, File>({
    mutationFn: async (file) => {
      const response = await apiUpload('/api/cv/audit', {
        file,
        token,
        schema: cvAuditJobResponseSchema,
      });
      return response.audit;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: auditUsageQueryKey(token) });
    },
  });
}

/**
 * Polls a durable audit job. The id lives in the URL, so a refresh resumes the same
 * query instead of depending on the original mutation's in-memory state.
 */
export function useAuditJobQuery(auditId: string | null) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery<CvAuditJob>({
    queryKey: auditJobQueryKey(token, auditId),
    enabled: token !== null && auditId !== null,
    queryFn: () =>
      apiRequest(`/api/cv/audits/${encodeURIComponent(auditId ?? '')}`, {
        token,
        schema: cvAuditJobResponseSchema,
      }).then((response) => response.audit),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'QUEUED' || status === 'PROCESSING' ? 1_500 : false;
    },
  });

  useEffect(() => {
    if (query.data?.status !== 'COMPLETED') return;
    void queryClient.invalidateQueries({ queryKey: auditUsageQueryKey(token) });
    void queryClient.invalidateQueries({ queryKey: cvHistoryQueryKey(token) });
  }, [query.data?.status, queryClient, token]);

  return query;
}
