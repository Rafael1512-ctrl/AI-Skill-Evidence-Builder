import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Route guard wiring (Phase 23).
 *
 * `requireAdmin()` only inspects the context that `requireAuth()` puts on the request, so mounting
 * it alone answers 401 to *everybody*, admins included - a real bug found by the testimonials
 * moderation suite (PROJECT_CONTEXT §8.51). This test asserts the invariant mechanically for every
 * router file, so the next admin-only route cannot ship without its authentication step.
 *
 * Pure and offline: it reads the route sources, nothing else.
 */

const routesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src/routes');

function routeFiles(): string[] {
  return readdirSync(routesDir).filter((name) => name.endsWith('.routes.ts'));
}

describe('admin routes are always authenticated first', () => {
  it('mounts requireAuth before every requireAdmin', () => {
    for (const file of routeFiles()) {
      const source = readFileSync(join(routesDir, file), 'utf8');
      const adminIndex = source.indexOf('requireAdmin(');
      if (adminIndex === -1) continue;

      const authIndex = source.indexOf('requireAuth(');
      expect(authIndex, `${file} mounts requireAdmin without requireAuth`).toBeGreaterThanOrEqual(
        0,
      );
      expect(authIndex, `${file} mounts requireAdmin before requireAuth`).toBeLessThan(adminIndex);
    }
  });

  it('covers every admin-only route in the router that declares one', () => {
    const guarded = routeFiles().filter((file) =>
      readFileSync(join(routesDir, file), 'utf8').includes('requireAdmin('),
    );

    // The admin router itself and the testimonial moderation routes.
    expect(guarded).toContain('admin.routes.ts');
    expect(guarded).toContain('testimonial.routes.ts');
  });

  it('guards the whole admin router once rather than per route', () => {
    const source = readFileSync(join(routesDir, 'admin.routes.ts'), 'utf8');

    // A single `use(requireAuth(), requireAdmin())` means a new route cannot ship unguarded.
    expect(source).toContain('adminRouter.use(requireAuth(), requireAdmin())');
    expect(source.match(/requireAdmin\(\)/g)).toHaveLength(1);
  });
});
