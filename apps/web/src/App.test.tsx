import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './App.js';

describe('App shell', () => {
  afterEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  it('presents both workflows on the landing shell', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: /bangun karier dengan cv yang diperkuat ai/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Pencari Kerja')).toBeInTheDocument();
    expect(screen.getByText('HRD / Rekruter')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pilih pencari kerja/i })).toHaveAttribute(
      'href',
      '/signin?next=%2Fdashboard%2Fjob-seeker',
    );
    expect(screen.getByRole('link', { name: /pilih hrd \/ rekruter/i })).toHaveAttribute(
      'href',
      '/signin?next=%2Fdashboard%2Fhrd',
    );
    expect(screen.queryByRole('link', { name: /admin/i })).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor from /profile to the sign-in page', async () => {
    window.history.pushState({}, '', '/profile');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /^masuk$/i })).toBeInTheDocument();
  });

  it('sends a signed-out visitor from /audit to the sign-in page', async () => {
    window.history.pushState({}, '', '/audit');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /^masuk$/i })).toBeInTheDocument();
  });

  it('protects both role dashboards behind the same account session', async () => {
    window.history.pushState({}, '', '/dashboard/hrd');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /^masuk$/i })).toBeInTheDocument();
  });
});
