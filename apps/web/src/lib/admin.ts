import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminFailedCandidateListSchema,
  adminJobListSchema,
  adminOverviewResponseSchema,
  adminTransactionListSchema,
  adminUserListSchema,
  featurePricingSchema,
  publicTestimonialListResponseSchema,
  testimonialListResponseSchema,
  testimonialResponseSchema,
  type Testimonial as TestimonialDto,
  type TestimonialStatus,
} from '@aseb/shared';
import { z } from 'zod';

import { apiRequest } from './api.js';
import { useAuth } from './auth.js';

/**
 * Admin console data.
 *
 * Every call is guarded server-side by `requireAdmin`; the UI hides the page from
 * non-admins as a convenience only. Nothing here computes a number: the API returns the
 * aggregates it already derived from the ledger and the usage records.
 */

// The API wraps each list in its own key inside the `data` envelope, so the schemas are
// wrapped the same way (the response contract is the whole envelope, not just the array).
const adminUsersResponseSchema = z.object({ users: adminUserListSchema });
const adminTransactionsResponseSchema = z.object({ transactions: adminTransactionListSchema });
const adminJobsResponseSchema = z.object({ jobs: adminJobListSchema });
const adminFailedResponseSchema = z.object({ failed: adminFailedCandidateListSchema });

export function useAdminOverviewQuery() {
  const { token, status, profile } = useAuth();
  const isAdmin = profile?.role === 'ADMIN';

  return useQuery({
    queryKey: ['admin', 'overview', token],
    enabled: status === 'signed-in' && token !== null && isAdmin,
    queryFn: () =>
      apiRequest('/api/admin/overview', { token, schema: adminOverviewResponseSchema }),
  });
}

export function useAdminUsersQuery(page = 1, pageSize = 20) {
  const { token, status, profile } = useAuth();

  return useQuery({
    queryKey: ['admin', 'users', token, page, pageSize],
    enabled: status === 'signed-in' && token !== null && profile?.role === 'ADMIN',
    queryFn: () =>
      apiRequest(`/api/admin/users?page=${page}&pageSize=${pageSize}`, {
        token,
        schema: adminUsersResponseSchema,
      }),
  });
}

export function useAdminTransactionsQuery(page = 1, pageSize = 20) {
  const { token, status, profile } = useAuth();

  return useQuery({
    queryKey: ['admin', 'transactions', token, page, pageSize],
    enabled: status === 'signed-in' && token !== null && profile?.role === 'ADMIN',
    queryFn: () =>
      apiRequest(`/api/admin/transactions?page=${page}&pageSize=${pageSize}`, {
        token,
        schema: adminTransactionsResponseSchema,
      }),
  });
}

export function useAdminJobsQuery(page = 1, pageSize = 20) {
  const { token, status, profile } = useAuth();

  return useQuery({
    queryKey: ['admin', 'jobs', token, page, pageSize],
    enabled: status === 'signed-in' && token !== null && profile?.role === 'ADMIN',
    queryFn: () =>
      apiRequest(`/api/admin/jobs?page=${page}&pageSize=${pageSize}`, {
        token,
        schema: adminJobsResponseSchema,
      }),
  });
}

export function useAdminFailedCandidatesQuery(page = 1, pageSize = 20) {
  const { token, status, profile } = useAuth();

  return useQuery({
    queryKey: ['admin', 'failed', token, page, pageSize],
    enabled: status === 'signed-in' && token !== null && profile?.role === 'ADMIN',
    queryFn: () =>
      apiRequest(`/api/admin/failed-candidates?page=${page}&pageSize=${pageSize}`, {
        token,
        schema: adminFailedResponseSchema,
      }),
  });
}

/** The moderation queue, filtered by status so a reviewer can work through `PENDING`. */
export function useAdminTestimonialsQuery(status: TestimonialStatus = 'PENDING', page = 1) {
  const { token, status: authStatus, profile } = useAuth();

  return useQuery({
    queryKey: ['admin', 'testimonials', status, token, page],
    enabled: authStatus === 'signed-in' && token !== null && profile?.role === 'ADMIN',
    queryFn: () =>
      apiRequest(`/api/testimonials/moderation?status=${status}&page=${page}&pageSize=20`, {
        token,
        schema: testimonialListResponseSchema,
      }),
  });
}

export function useModerateTestimonialMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<TestimonialDto, Error, { id: string; status: TestimonialStatus }>({
    mutationFn: async ({ id, status }) => {
      const response = await apiRequest(`/api/testimonials/${id}/moderation`, {
        method: 'PATCH',
        body: { status },
        token,
        schema: testimonialResponseSchema,
      });
      return response.testimonial;
    },
    onSuccess: () => {
      // Both the queue and the public list change when a review is moderated.
      void queryClient.invalidateQueries({ queryKey: ['admin', 'testimonials'] });
      void queryClient.invalidateQueries({ queryKey: ['testimonials'] });
    },
  });
}

export function useUpdateFeaturePricingMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<
    z.infer<typeof featurePricingSchema>,
    Error,
    { feature: string; credits: number }
  >({
    mutationFn: async ({ feature, credits }) => {
      const response = await apiRequest(`/api/admin/pricing/${feature}`, {
        method: 'PUT',
        body: { credits },
        token,
        schema: z.object({ pricing: featurePricingSchema }),
      });
      return response.pricing;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
      void queryClient.invalidateQueries({ queryKey: ['credits', 'pricing'] });
    },
  });
}

/** Approved reviews as a plain count source for the console; public shape, no status. */
export const adminPublicTestimonialsSchema = publicTestimonialListResponseSchema;
