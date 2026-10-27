import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  googleConnectResponseSchema,
  profileUpdateResponseSchema,
  type ProfileUpdateInput,
} from '@aseb/shared';

import { apiRequest } from './api.js';
import { profileQueryKey, useAuth } from './auth.js';

/** Saves the fields a user owns. The server rejects anything else. */
export function useUpdateProfileMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ProfileUpdateInput) =>
      apiRequest('/api/profile', {
        method: 'PATCH',
        body: input,
        token,
        schema: profileUpdateResponseSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(token) });
    },
  });
}

/** Asks the API whether Google linking is allowed before the browser starts the OAuth flow. */
export function useConnectGoogleMutation() {
  const { token } = useAuth();

  return useMutation({
    mutationFn: () =>
      apiRequest('/api/profile/google/connect', {
        method: 'POST',
        token,
        schema: googleConnectResponseSchema,
      }),
  });
}
