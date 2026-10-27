import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import {
  bulkVerificationResponseSchema,
  screeningBatchUploadResponseSchema,
  screeningCandidateListResponseSchema,
  screeningJobListSchema,
  screeningJobResponseSchema,
  screeningProgressResponseSchema,
  screeningReportListResponseSchema,
  screeningReportResponseSchema,
  screeningResultPayloadResponseSchema,
  screeningVerificationEstimateResponseSchema,
  candidateVerificationResponseSchema,
  type BulkVerificationResult,
  type CreateScreeningJobRequest,
  type ReportFormat,
  type ScreeningBatchUploadResult,
  type ScreeningJobDetail,
  type ScreeningJobSummary,
  type ScreeningReportResult,
  type ScreeningVerificationEstimate,
  type CandidateVerificationResult,
} from '@aseb/shared';

import { apiRequest, apiUploadMany } from './api.js';
import { useAuth } from './auth.js';

/**
 * Screening data access for the recruiter UI.
 *
 * Everything the recruiter sees comes from the API's stored results: the web app never
 * computes a score, it renders what the deterministic engine already decided.
 */

export function useScreeningJobsQuery(page = 1, pageSize = 20) {
  const { token, status } = useAuth();

  return useQuery({
    queryKey: ['screening', 'jobs', token, page, pageSize],
    enabled: status === 'signed-in' && token !== null,
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiRequest(`/api/screening/jobs?page=${page}&pageSize=${pageSize}`, {
        token,
        schema: screeningJobListSchema,
      }),
  });
}

export function useScreeningJobQuery(jobId: string | undefined) {
  const { token, status } = useAuth();

  return useQuery({
    queryKey: ['screening', 'job', jobId, token],
    enabled: status === 'signed-in' && token !== null && Boolean(jobId),
    queryFn: () =>
      apiRequest(`/api/screening/jobs/${jobId as string}`, {
        token,
        schema: screeningJobResponseSchema,
      }),
  });
}

/** Polls while the batch is still running, then stops. */
export function useScreeningProgressQuery(job: ScreeningJobDetail | undefined) {
  const { token, status } = useAuth();
  const finished = job
    ? ['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'].includes(job.state)
    : false;

  return useQuery({
    queryKey: ['screening', 'progress', job?.id, token],
    enabled: status === 'signed-in' && token !== null && Boolean(job?.id),
    refetchInterval: finished ? false : 3_000,
    queryFn: () =>
      apiRequest(`/api/screening/jobs/${job?.id as string}/progress`, {
        token,
        schema: screeningProgressResponseSchema,
      }),
  });
}

export function useScreeningResultsQuery(jobId: string | undefined, enabled = true) {
  const { token, status } = useAuth();

  return useQuery({
    queryKey: ['screening', 'results', jobId, token],
    enabled: enabled && status === 'signed-in' && token !== null && Boolean(jobId),
    queryFn: () =>
      apiRequest(`/api/screening/jobs/${jobId as string}/results`, {
        token,
        schema: screeningResultPayloadResponseSchema,
      }),
  });
}

export function useScreeningCandidatesQuery(jobId: string | undefined, page = 1, pageSize = 50) {
  const { token, status } = useAuth();

  return useQuery({
    queryKey: ['screening', 'candidates', jobId, token, page, pageSize],
    enabled: status === 'signed-in' && token !== null && Boolean(jobId),
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiRequest(
        `/api/screening/jobs/${jobId as string}/candidates?page=${page}&pageSize=${pageSize}`,
        {
          token,
          schema: screeningCandidateListResponseSchema,
        },
      ),
  });
}

export function useCreateScreeningJobMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<ScreeningJobDetail, Error, CreateScreeningJobRequest>({
    mutationFn: async (input) => {
      const response = await apiRequest('/api/screening/jobs', {
        method: 'POST',
        body: input,
        token,
        schema: screeningJobResponseSchema,
      });
      return response.job;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['screening', 'jobs'] });
    },
  });
}

export function useUploadCandidatesMutation(jobId: string) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<ScreeningBatchUploadResult, Error, readonly File[]>({
    mutationFn: (files) =>
      apiUploadMany(`/api/screening/jobs/${jobId}/candidates`, {
        files,
        token,
        schema: screeningBatchUploadResponseSchema,
      }).then((response) => response.batch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['screening'] });
    },
  });
}

export function useCancelScreeningJobMutation(jobId: string) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<ScreeningJobDetail, Error, void>({
    mutationFn: async () => {
      const response = await apiRequest(`/api/screening/jobs/${jobId}`, {
        method: 'PATCH',
        body: { state: 'CANCELLED' },
        token,
        schema: screeningJobResponseSchema,
      });
      return response.job;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['screening'] });
    },
  });
}

export function useExportScreeningReportMutation(jobId: string) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<ScreeningReportResult, Error, ReportFormat>({
    mutationFn: async (format) => {
      const response = await apiRequest(`/api/screening/jobs/${jobId}/reports`, {
        method: 'POST',
        body: { format },
        token,
        schema: screeningReportResponseSchema,
      });
      return response.report;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['screening', 'reports', jobId] });
    },
  });
}

export function useScreeningReportsQuery(jobId: string | undefined, page = 1, pageSize = 10) {
  const { token, status } = useAuth();

  return useQuery({
    queryKey: ['screening', 'reports', jobId, token, page, pageSize],
    enabled: status === 'signed-in' && token !== null && Boolean(jobId),
    queryFn: () =>
      apiRequest(
        `/api/screening/jobs/${jobId as string}/reports?page=${page}&pageSize=${pageSize}`,
        {
          token,
          schema: screeningReportListResponseSchema,
        },
      ),
  });
}

/**
 * After any verification the stored results, the bulk preflight and the wallet have all moved.
 * The wallet matters for the "sesudah" balance the screen shows once the charge settles.
 */
function invalidateAfterVerification(queryClient: QueryClient, jobId: string): void {
  void queryClient.invalidateQueries({ queryKey: ['screening', 'results', jobId] });
  void queryClient.invalidateQueries({ queryKey: ['screening', 'verification-estimate', jobId] });
  void queryClient.invalidateQueries({ queryKey: ['credits', 'wallet'] });
}

/** Checks the links a CV contains; billed once per candidate when a page was fetched. */
export function useVerifyCandidateEvidenceMutation(jobId: string) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<CandidateVerificationResult, Error, string>({
    mutationFn: async (candidateId) => {
      const response = await apiRequest(
        `/api/screening/jobs/${jobId}/candidates/${candidateId}/verification`,
        {
          method: 'POST',
          token,
          schema: candidateVerificationResponseSchema,
        },
      );
      return response.verification;
    },
    onSuccess: () => {
      invalidateAfterVerification(queryClient, jobId);
    },
  });
}

/**
 * The bulk preflight.
 *
 * The server decides who is eligible and what one candidate costs, so the confirmation the
 * recruiter sees is exactly what the bulk run will charge - the browser never computes a price.
 */
export function useVerificationEstimateQuery(jobId: string | undefined, enabled = true) {
  const { token, status } = useAuth();

  return useQuery<ScreeningVerificationEstimate>({
    queryKey: ['screening', 'verification-estimate', jobId, token],
    enabled: enabled && status === 'signed-in' && token !== null && Boolean(jobId),
    queryFn: () =>
      apiRequest(`/api/screening/jobs/${jobId as string}/verification/estimate`, {
        token,
        schema: screeningVerificationEstimateResponseSchema,
      }).then((response) => response.estimate),
  });
}

/** Verifies every eligible candidate of the job in one server-side action. */
export function useVerifyAllCandidatesMutation(jobId: string) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<BulkVerificationResult, Error, void>({
    mutationFn: async () => {
      const response = await apiRequest(`/api/screening/jobs/${jobId}/verification`, {
        method: 'POST',
        token,
        schema: bulkVerificationResponseSchema,
      });
      return response.verification;
    },
    onSuccess: () => {
      invalidateAfterVerification(queryClient, jobId);
    },
  });
}

/** Base64 -> Blob -> download. Same approach as the CV export (no storage provider yet). */
export function downloadBase64Report(
  report: Pick<ScreeningReportResult, 'contentBase64' | 'fileName' | 'mimeType'>,
): void {
  const binary = window.atob(report.contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const url = URL.createObjectURL(new Blob([bytes], { type: report.mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = report.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export type { ScreeningJobSummary };
