import { useMutation } from '@tanstack/react-query';

import { cvAuditResponseSchema, type CvAuditResponse } from '@aseb/shared';

import { apiUpload } from './api.js';
import { useAuth } from './auth.js';

/**
 * Submits a CV for the free audit.
 *
 * Works signed-out on purpose: the guest flow is 0 credits and the API keeps the upload
 * in memory. When a token is present the API also stores the analysis so the user can
 * find it again from their history.
 */
export function useAuditCvMutation() {
  const { token } = useAuth();

  return useMutation<CvAuditResponse, Error, File>({
    mutationFn: (file) =>
      apiUpload('/api/cv/audit', { file, token, schema: cvAuditResponseSchema }),
  });
}
