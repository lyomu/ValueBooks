'use client';

import {
  Button,
  Dialog,
  DialogContent,
  FieldMessage,
  FormField,
  Input,
  Label,
  Textarea,
} from '@valuebooks/ui';
import { useEffect, useId, useState, type ReactNode } from 'react';

import { ApiError } from '../lib/api';

const MIN_REASON = 10;

/**
 * The one confirmation pattern for privileged Platform Admin actions (master plan §6.1, §18.2):
 * states the impact, collects the audited reason, optionally requires typing a confirmation
 * phrase for high-impact changes, and shows the server's refusal in place. Authorization is still
 * the server's decision; this dialog only makes the operator's intent explicit.
 *
 * Actions that need input beyond the reason (a new plan code, a trial extension length) pass their
 * own controlled inputs as `fields` and hold the confirm button with `confirmDisabled` until those
 * inputs are valid. The dialog still owns the reason, the confirmation phrase and the error.
 */
export function AdminActionDialog({
  open,
  onOpenChange,
  title,
  description,
  impact,
  confirmLabel,
  tone = 'primary',
  requireReason = true,
  confirmationPhrase,
  fields,
  confirmDisabled = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** What will happen, to whom, and what it does not do. */
  impact: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  requireReason?: boolean;
  /** When set, the operator must type this exact text (e.g. the organization's name). */
  confirmationPhrase?: string;
  /** Action-specific inputs, rendered between the impact and the reason. */
  fields?: ReactNode;
  /** Keeps confirm disabled while `fields` are incomplete or invalid. */
  confirmDisabled?: boolean;
  /** Throws to keep the dialog open with the error shown; resolves to close it. */
  onConfirm: (reason: string) => Promise<void>;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setReason('');
      setTyped('');
      setError('');
    }
  }, [open]);

  const reasonValid = !requireReason || reason.trim().length >= MIN_REASON;
  const phraseValid = !confirmationPhrase || typed.trim() === confirmationPhrase;

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent title={title} description={description}>
        <div className="rb-admin-action">
          <div className="rb-admin-action__impact">{impact}</div>
          {fields}
          {requireReason ? (
            <FormField>
              <Label htmlFor={`${id}-reason`}>Reason</Label>
              <Textarea
                id={`${id}-reason`}
                value={reason}
                maxLength={500}
                rows={3}
                onChange={(event) => setReason(event.target.value)}
              />
              <FieldMessage>
                Recorded in the audit log. At least {MIN_REASON} characters.
              </FieldMessage>
            </FormField>
          ) : null}
          {confirmationPhrase ? (
            <FormField>
              <Label htmlFor={`${id}-confirm`}>
                Type <strong>{confirmationPhrase}</strong> to confirm
              </Label>
              <Input
                id={`${id}-confirm`}
                value={typed}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
              />
            </FormField>
          ) : null}
          {error ? (
            <p className="rb-admin-action__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="rb-admin-action__footer">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={busy}
              disabled={!reasonValid || !phraseValid || confirmDisabled}
              onClick={() => void confirm()}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
