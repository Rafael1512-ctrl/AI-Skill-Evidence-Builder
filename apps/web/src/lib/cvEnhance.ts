import { useMutation } from '@tanstack/react-query';

import {
  cvEnhancementResponseSchema,
  type CvEnhancementDetail,
  type CvEnhancementOptions,
} from '@aseb/shared';

import { apiUpload } from './api.js';
import { useAuth } from './auth.js';

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
  });
}
