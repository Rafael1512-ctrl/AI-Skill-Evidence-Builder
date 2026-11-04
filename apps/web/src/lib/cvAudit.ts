import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cvAuditResponseSchema,
  cvAuditUsageSchema,
  type CvAuditResponse,
  type CvAuditUsage,
} from '@aseb/shared';

import { apiRequest, apiUpload } from './api.js';
import { useAuth } from './auth.js';

export function auditUsageQueryKey(token: string | null) {
  return ['cv-audit-usage', token] as const;
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

  return useMutation<CvAuditResponse, Error, File>({
    mutationFn: (file) =>
      apiUpload('/api/cv/audit', { file, token, schema: cvAuditResponseSchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: auditUsageQueryKey(token) });
    },
  });
}
