import { useMutation } from '@tanstack/react-query';

import {
  cvExportResponseSchema,
  type CvExportResult,
  type CvTemplateKey,
} from '@aseb/shared';

import { apiRequest } from './api.js';
import { useAuth } from './auth.js';

export interface ExportCvVariables {
  enhancementId: string;
  templateKey: CvTemplateKey;
}

/**
 * Renders a completed enhancement to PDF.
 *
 * Paid: the API reserves `CV_PDF_EXPORT` before Chromium runs and settles only when the
 * file is produced, so a failed export costs nothing.
 */
export function useExportCvMutation() {
  const { token } = useAuth();

  return useMutation<CvExportResult, Error, ExportCvVariables>({
    mutationFn: async ({ enhancementId, templateKey }) => {
      const response = await apiRequest(`/api/cv/enhancements/${enhancementId}/export`, {
        method: 'POST',
        body: { templateKey },
        token,
        schema: cvExportResponseSchema,
      });
      return response.export;
    },
  });
}

/** Decodes the base64 payload and triggers the browser download. */
export function downloadBase64Pdf(
  result: Pick<CvExportResult, 'contentBase64' | 'fileName' | 'mimeType'>,
): void {
  const binary = window.atob(result.contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
