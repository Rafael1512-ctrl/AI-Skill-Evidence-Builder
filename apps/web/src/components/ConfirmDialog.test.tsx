import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog.js';

describe('ConfirmDialog', () => {
  it('renders a labelled modal with the given content', () => {
    render(
      <ConfirmDialog
        open
        title="Konfirmasi verifikasi"
        confirmLabel="Lanjutkan"
        onConfirm={() => {}}
        onCancel={() => {}}
      >
        <p>Verifikasi kandidat ini akan menggunakan 2 kredit. Lanjutkan?</p>
      </ConfirmDialog>,
    );

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Konfirmasi verifikasi');
    expect(screen.getByText(/2 kredit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lanjutkan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Batal' })).toBeInTheDocument();
  });

  it('cancels on Escape but keeps the dialog while an action is running', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open
        title="Konfirmasi verifikasi"
        confirmLabel="Lanjutkan"
        busy
        onConfirm={() => {}}
        onCancel={onCancel}
      >
        <p>Memproses…</p>
      </ConfirmDialog>,
    );

    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();

    rerender(
      <ConfirmDialog
        open
        title="Konfirmasi verifikasi"
        confirmLabel="Lanjutkan"
        onConfirm={() => {}}
        onCancel={onCancel}
      >
        <p>Siap</p>
      </ConfirmDialog>,
    );

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Konfirmasi verifikasi"
        confirmLabel="Lanjutkan"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
