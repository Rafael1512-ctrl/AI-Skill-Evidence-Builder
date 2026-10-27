import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import {
  configureSupabaseEnv,
  resetSupabaseMock,
  setSupabaseSession,
} from '../test/supabase-mock.js';
import { TestimonialForm, TestimonialsPage } from './TestimonialsPage.js';

vi.mock('@supabase/supabase-js', async () => {
  const mock = await import('../test/supabase-mock.js');
  return { createClient: mock.createClientMock } as unknown;
});

const PROFILE = {
  id: 'user-1',
  email: 'siti@example.com',
  emailVerified: true,
  role: 'USER',
  fullName: 'Siti',
  headline: null,
  phone: null,
  location: null,
  avatarUrl: null,
  linkedinUrl: null,
  githubUrl: null,
  portfolioUrl: null,
  githubUsername: null,
  hasPassword: true,
  googleConnected: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const TESTIMONIAL = {
  id: 'testi-1',
  rating: 5,
  comment: 'Audit CV-nya jelas dan membantu saya memperbaiki struktur.',
  displayName: 'Andi',
  createdAt: '2026-09-26T10:00:00.000Z',
};

const fetchMock = vi.fn();

function jsonResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

function respondWith(items: unknown[], posts: unknown[] = []) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/api/profile')) {
      return jsonResponse({
        data: {
          profile: PROFILE,
          googleLink: { supported: false, reason: null, method: null, redirectTo: null },
        },
      });
    }
    if (url.includes('/api/testimonials/mine')) {
      return jsonResponse({
        data: { testimonials: { items: [], page: 1, pageSize: 20, total: 0 } },
      });
    }
    return jsonResponse({
      data: { testimonials: { items, page: 1, pageSize: 12, total: items.length } },
    });
  });
  posts.length = 0;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter>
          <TestimonialsPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TestimonialForm enhancementId="enh-1" />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('TestimonialsPage', () => {
  beforeEach(() => {
    resetSupabaseMock();
    configureSupabaseEnv();
    setSupabaseSession({ access_token: 'token-1' });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('renders the approved testimonials with their rating', async () => {
    respondWith([TESTIMONIAL]);
    renderPage();

    expect(await screen.findByText('Andi')).toBeInTheDocument();
    expect(screen.getByText(/Audit CV-nya jelas/)).toBeInTheDocument();
    expect(screen.getByLabelText('5 dari 5')).toBeInTheDocument();
  });

  it('says so when nothing has been published yet', async () => {
    respondWith([]);
    renderPage();

    expect(await screen.findByText('Belum ada testimoni yang tayang.')).toBeInTheDocument();
  });

  it('validates the review before sending it', async () => {
    respondWith([]);
    renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Testimoni'), 'pendek');
    await user.click(screen.getByRole('button', { name: 'Kirim testimoni' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('minimal 10 karakter');
    expect(
      fetchMock.mock.calls.filter(([, init]) => (init as { method?: string })?.method === 'POST'),
    ).toHaveLength(0);
  });

  it('submits the review tied to the enhancement and reports moderation', async () => {
    fetchMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (url.includes('/api/profile')) {
        return jsonResponse({
          data: {
            profile: PROFILE,
            googleLink: { supported: false, reason: null, method: null, redirectTo: null },
          },
        });
      }
      if (url.includes('/api/testimonials') && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            data: {
              testimonial: {
                ...TESTIMONIAL,
                displayName: 'Siti',
                status: 'PENDING',
                moderatedAt: null,
              },
            },
          }),
        };
      }
      return jsonResponse({
        data: { testimonials: { items: [], page: 1, pageSize: 20, total: 0 } },
      });
    });
    renderForm();
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText('Testimoni'),
      'Membantu sekali, hasilnya sesuai isi CV saya.',
    );
    await user.click(screen.getByRole('button', { name: 'Kirim testimoni' }));

    expect(await screen.findByText(/menunggu moderasi/i)).toBeInTheDocument();

    const post = fetchMock.mock.calls.find(
      ([, init]) => (init as { method?: string })?.method === 'POST',
    );
    expect(post?.[0]).toBe('/api/testimonials');
    expect(JSON.parse((post?.[1] as { body: string }).body)).toMatchObject({
      rating: 5,
      enhancementId: 'enh-1',
    });
  });
});
