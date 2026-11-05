import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminAiUsageListSchema,
  adminCreditAdjustmentResponseSchema,
  adminFailedCandidateListSchema,
  adminJobListSchema,
  adminOverviewResponseSchema,
  adminPaymentListSchema,
  adminReportResponseSchema,
  adminTransactionListSchema,
  adminUserListSchema,
  adminWebhookEventListSchema,
  featurePricingSchema,
  publicTestimonialListResponseSchema,
  testimonialListResponseSchema,
  testimonialResponseSchema,
  type Testimonial as TestimonialDto,
  type TestimonialStatus,
  type UserRole,
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
const adminPaymentsResponseSchema = z.object({ payments: adminPaymentListSchema });
const adminWebhookEventsResponseSchema = z.object({ events: adminWebhookEventListSchema });
const adminAiUsageResponseSchema = z.object({ usage: adminAiUsageListSchema });

export interface AdminReportFilters {
  from: string;
  to: string;
  feature?: string;
  search?: string;
  sort: 'usage' | 'purchases' | 'balance';
  page: number;
  pageSize: number;
}

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

export function useAdminSearchUsersQuery(
  filters: { search?: string; role?: UserRole; page?: number; pageSize?: number } = {},
) {
  const { token, status, profile } = useAuth();
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;

  return useQuery({
    queryKey: ['admin', 'users', token, filters.search, filters.role, page, pageSize],
    enabled: status === 'signed-in' && token !== null && profile?.role === 'ADMIN',
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (filters.search) params.set('search', filters.search);
      if (filters.role) params.set('role', filters.role);
      return apiRequest(`/api/admin/users?${params.toString()}`, {
        token,
        schema: adminUsersResponseSchema,
      });
    },
  });
}

export function useAdminReportsQuery(filters: AdminReportFilters) {
  const { token, status, profile } = useAuth();

  return useQuery({
    queryKey: ['admin', 'reports', token, filters],
    enabled: status === 'signed-in' && token !== null && profile?.role === 'ADMIN',
    queryFn: () => {
      const params = new URLSearchParams({
        from: filters.from,
        to: filters.to,
        sort: filters.sort,
        page: String(filters.page),
        pageSize: String(filters.pageSize),
      });
      if (filters.feature) params.set('feature', filters.feature);
      if (filters.search) params.set('search', filters.search);
      return apiRequest(`/api/admin/reports?${params.toString()}`, {
        token,
        schema: adminReportResponseSchema,
      });
    },
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

export function useAdminPaymentsQuery(page = 1, pageSize = 20) {
  const { token, status, profile } = useAuth();

  return useQuery({
    queryKey: ['admin', 'payments', token, page, pageSize],
    enabled: status === 'signed-in' && token !== null && profile?.role === 'ADMIN',
    queryFn: () =>
      apiRequest(`/api/admin/payments?page=${page}&pageSize=${pageSize}`, {
        token,
        schema: adminPaymentsResponseSchema,
      }),
  });
}

export function useAdminWebhookEventsQuery(page = 1, pageSize = 20) {
  const { token, status, profile } = useAuth();

  return useQuery({
    queryKey: ['admin', 'webhook-events', token, page, pageSize],
    enabled: status === 'signed-in' && token !== null && profile?.role === 'ADMIN',
    queryFn: () =>
      apiRequest(`/api/admin/webhook-events?page=${page}&pageSize=${pageSize}`, {
        token,
        schema: adminWebhookEventsResponseSchema,
      }),
  });
}

export function useAdminAiUsageQuery(
  filters: { feature?: string; page?: number; pageSize?: number } = {},
) {
  const { token, status, profile } = useAuth();
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;

  return useQuery({
    queryKey: ['admin', 'ai-usage', token, filters.feature, page, pageSize],
    enabled: status === 'signed-in' && token !== null && profile?.role === 'ADMIN',
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (filters.feature) params.set('feature', filters.feature);
      return apiRequest(`/api/admin/ai-usage?${params.toString()}`, {
        token,
        schema: adminAiUsageResponseSchema,
      });
    },
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

export function useUpdateAdminUserRoleMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: UserRole }) => {
      const response = await apiRequest(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: { role },
        token,
        schema: z.object({
          user: z.object({
            id: z.string(),
            email: z.string(),
            role: z.enum(['USER', 'ADMIN']),
            updatedAt: z.string(),
          }),
        }),
      });
      return response.user;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
    },
  });
}

export function useAdjustAdminCreditsMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, amount, reason }: { userId: string; amount: number; reason: string }) =>
      apiRequest(`/api/admin/users/${userId}/credits`, {
        method: 'POST',
        body: { amount, reason },
        token,
        schema: adminCreditAdjustmentResponseSchema,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
      void queryClient.invalidateQueries({ queryKey: ['credits'] });
    },
  });
}

/** Approved reviews as a plain count source for the console; public shape, no status. */
export const adminPublicTestimonialsSchema = publicTestimonialListResponseSchema;
