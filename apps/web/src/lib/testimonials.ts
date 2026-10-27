import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  publicTestimonialListResponseSchema,
  testimonialListResponseSchema,
  testimonialResponseSchema,
  type CreateTestimonialInput,
  type Testimonial as TestimonialDto,
} from '@aseb/shared';

import { apiRequest } from './api.js';
import { useAuth } from './auth.js';

/** Approved testimonials only; safe to call signed-out. */
export function usePublicTestimonialsQuery(page = 1, pageSize = 12) {
  return useQuery({
    queryKey: ['testimonials', 'public', page, pageSize],
    queryFn: () =>
      apiRequest(`/api/testimonials?page=${page}&pageSize=${pageSize}`, {
        schema: publicTestimonialListResponseSchema,
      }),
  });
}

/** The caller's own reviews, with status, so the form can show "menunggu moderasi". */
export function useMyTestimonialsQuery(page = 1, pageSize = 20) {
  const { token, status } = useAuth();

  return useQuery({
    queryKey: ['testimonials', 'mine', token, page, pageSize],
    enabled: status === 'signed-in' && token !== null,
    queryFn: () =>
      apiRequest(`/api/testimonials/mine?page=${page}&pageSize=${pageSize}`, {
        token,
        schema: testimonialListResponseSchema,
      }),
  });
}

export function useSubmitTestimonialMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<TestimonialDto, Error, CreateTestimonialInput>({
    mutationFn: async (input) => {
      const response = await apiRequest('/api/testimonials', {
        method: 'POST',
        body: input,
        token,
        schema: testimonialResponseSchema,
      });
      return response.testimonial;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['testimonials'] });
    },
  });
}
