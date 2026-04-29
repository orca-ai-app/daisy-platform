/**
 * AssignFranchiseeModal — assign / reassign / unassign a territory.
 *
 * Reference: docs/M1-build-plan.md §6 Wave 3 Agent 3A.
 *
 * The form is intentionally tiny:
 *  - Franchisee dropdown (with an "Unassigned" option for clearing).
 *  - Status radio (active / vacant / reserved).
 *  - Submit calls useAssignTerritory which targets the assign-territory
 *    Edge Function.
 *
 * The dialog auto-closes on success, fires a toast, and surfaces any
 * server error inline with a retry button.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  useAssignTerritory,
  useFranchiseesForAssignment,
  type TerritoryRow,
  type TerritoryStatus,
} from './queries';

interface AssignFranchiseeModalProps {
  territory: TerritoryRow;
  open: boolean;
  onClose: () => void;
}

const STATUS_OPTIONS: Array<{ value: TerritoryStatus; label: string; hint: string }> = [
  { value: 'active', label: 'Active', hint: 'Franchisee currently runs this territory' },
  { value: 'vacant', label: 'Vacant', hint: 'No franchisee assigned, available' },
  { value: 'reserved', label: 'Reserved', hint: 'Held for a planned assignment' },
];

const UNASSIGNED_VALUE = '__unassigned__';

export function AssignFranchiseeModal({ territory, open, onClose }: AssignFranchiseeModalProps) {
  const franchisees = useFranchiseesForAssignment();
  const assign = useAssignTerritory();

  // Local form state — controlled rather than RHF since the form is two
  // fields and we want fast reset semantics on every open.
  const [franchiseeValue, setFranchiseeValue] = useState<string>(
    territory.franchisee_id ?? UNASSIGNED_VALUE,
  );
  const [statusValue, setStatusValue] = useState<TerritoryStatus>(territory.status);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset whenever the modal opens with a fresh territory.
  useEffect(() => {
    if (open) {
      setFranchiseeValue(territory.franchisee_id ?? UNASSIGNED_VALUE);
      setStatusValue(territory.status);
      setErrorMessage(null);
    }
  }, [open, territory]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const nextFranchiseeId = franchiseeValue === UNASSIGNED_VALUE ? null : franchiseeValue;

    try {
      await assign.mutateAsync({
        territory_id: territory.id,
        franchisee_id: nextFranchiseeId,
        status: statusValue,
      });
      toast.success(
        nextFranchiseeId
          ? `Territory ${territory.postcode_prefix} assigned`
          : `Territory ${territory.postcode_prefix} unassigned`,
      );
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Assignment failed';
      setErrorMessage(message);
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {territory.franchisee_id
              ? `Reassign ${territory.postcode_prefix}`
              : `Assign ${territory.postcode_prefix}`}
          </DialogTitle>
          <DialogDescription>{territory.name} — every change is audit-logged.</DialogDescription>
        </DialogHeader>

        <form className="mt-4 flex flex-col gap-5" onSubmit={(e) => void handleSubmit(e)}>
          {/* Franchisee dropdown ------------------------------------ */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="franchisee-select">Franchisee</Label>
            <select
              id="franchisee-select"
              className="border-daisy-line text-daisy-ink focus-visible:border-daisy-primary h-10 w-full rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              value={franchiseeValue}
              onChange={(e) => setFranchiseeValue(e.target.value)}
              disabled={franchisees.isLoading}
            >
              <option value={UNASSIGNED_VALUE}>— Unassigned —</option>
              {(franchisees.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.number} · {f.name}
                </option>
              ))}
            </select>
            {franchisees.isError ? (
              <p className="text-daisy-orange text-xs">
                Failed to load franchisees: {franchisees.error.message}
              </p>
            ) : null}
          </div>

          {/* Status radio ------------------------------------------- */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-daisy-ink text-sm font-semibold">Status</legend>
            <div className="flex flex-col gap-2">
              {STATUS_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-[8px] border p-3 transition-colors ${
                    statusValue === opt.value
                      ? 'border-daisy-primary bg-daisy-primary-tint'
                      : 'border-daisy-line bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="status"
                    value={opt.value}
                    checked={statusValue === opt.value}
                    onChange={() => setStatusValue(opt.value)}
                    className="mt-1"
                  />
                  <div className="flex flex-col">
                    <span className="text-daisy-ink text-sm font-semibold">{opt.label}</span>
                    <span className="text-daisy-muted text-xs">{opt.hint}</span>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          {errorMessage ? (
            <div
              role="alert"
              className="border-daisy-orange/40 bg-daisy-orange/10 text-daisy-orange flex flex-col gap-2 rounded-[8px] border p-3 text-sm"
            >
              <p className="font-semibold">Could not save</p>
              <p>{errorMessage}</p>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={assign.isPending}
              >
                Try again
              </Button>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={assign.isPending}>
              {assign.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default AssignFranchiseeModal;
