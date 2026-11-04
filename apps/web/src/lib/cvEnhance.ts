import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  cvEnhancementResponseSchema,
  type CvEnhancementDetail,
  type CvEnhancementOptions,
} from '@aseb/shared';

import { apiUpload } from './api.js';
import { useAuth } from './auth.js';
import { cvHistoryQueryKey } from './cvHistory.js';

export interface EnhanceCvVariables {
  file: File;
  options: CvEnhancementOptions;
}

/**
 * Submits a CV for the paid enhancement.
 *
 * The options travel as a JSON string field so the PDF and the parameters stay in one
 * multipart request. The API reserves the credits before calling the model; the
 * mutation only resolves once a validated, stored document comes back.
 */
export function useEnhanceCvMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<CvEnhancementDetail, Error, EnhanceCvVariables>({
    mutationFn: async ({ file, options }) => {
      const response = await apiUpload('/api/cv/enhance', {
        file,
        fields: { options: JSON.stringify(options) },
        token,
        schema: cvEnhancementResponseSchema,
      });
      return response.enhancement;
    },
    // Settled, not success: a failed attempt is stored too and belongs in the history.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cvHistoryQueryKey(token) });
    },
  });
}
