/**
 * Authorization roles.
 *
 * A normal authenticated user may use BOTH the job-seeker and the recruiter
 * workflows: role separation is not the product boundary, the credit wallet and
 * the feature entry points are. Only ADMIN is a genuinely privileged role and it
 * is always enforced server-side.
 */
export const USER_ROLES = ['USER', 'ADMIN'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isAdminRole(role: UserRole | null | undefined): boolean {
  return role === 'ADMIN';
}
