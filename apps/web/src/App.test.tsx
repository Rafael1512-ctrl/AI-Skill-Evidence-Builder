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
  });

  it('sends a signed-out visitor from /profile to the sign-in page', async () => {
    window.history.pushState({}, '', '/profile');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /^masuk$/i })).toBeInTheDocument();
  });
});
