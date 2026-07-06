/**
 * Saved email lists: table of lists with member counts, a create dialog
 * and per-row delete. Rows open the list detail page.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { ListPlus, Trash2, Users } from 'lucide-react';
import { DataTable, EmptyState, PageHeader } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRole } from '@/features/auth/RoleContext';
import { EmailSectionTabs } from './EmailSectionTabs';
import { useCreateEmailList, useDeleteEmailList, useEmailLists, type EmailList } from './queries';
import { formatDate } from './broadcastHelpers';

export default function ListsPage() {
  const navigate = useNavigate();
  const { franchisee } = useRole();

  const lists = useEmailLists();
  const createList = useCreateEmailList();
  const deleteList = useDeleteEmailList();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error('Give the list a name.');
      return;
    }
    try {
      const row = await createList.mutateAsync({ name, created_by: franchisee?.id ?? null });
      setCreateOpen(false);
      setNewName('');
      toast.success(`List "${name}" created`);
      void navigate(`/hq/emails/lists/${row.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    }
  };

  const handleDelete = async (list: EmailList) => {
    // Plain web app, so window.confirm is fine here (not the Tauri webview).
    if (
      !window.confirm(
        `Delete "${list.name}" and its ${list.member_count} member${list.member_count === 1 ? '' : 's'}? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await deleteList.mutateAsync(list.id);
      toast.success(`List "${list.name}" deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const columns = useMemo<ColumnDef<EmailList>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => <span className="font-bold">{row.original.name}</span>,
      },
      {
        accessorKey: 'member_count',
        header: 'Members',
        cell: ({ row }) => <span className="font-semibold">{row.original.member_count}</span>,
      },
      {
        accessorKey: 'updated_at',
        header: 'Updated',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">
            {formatDate(row.original.updated_at)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            aria-label={`Delete list ${row.original.name}`}
            onClick={(e) => {
              e.stopPropagation();
              void handleDelete(row.original);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Email lists"
        subtitle="Hand-managed recipient lists for broadcast emails. Import from CSV or add people one at a time."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <ListPlus className="h-4 w-4" />
            New list
          </Button>
        }
      />
      <EmailSectionTabs />

      {lists.isError ? (
        <p className="text-daisy-orange text-sm">Failed to load lists: {lists.error.message}</p>
      ) : (
        <DataTable<EmailList>
          columns={columns}
          data={lists.data ?? []}
          isLoading={lists.isLoading}
          searchPlaceholder="Search lists…"
          onRowClick={(row) => void navigate(`/hq/emails/lists/${row.id}`)}
          emptyState={
            <EmptyState
              icon={<Users />}
              title="No lists yet"
              body="Create a list, then add members by hand or import a CSV. Broadcasts can target any list."
              action={
                <Button onClick={() => setCreateOpen(true)}>
                  <ListPlus className="h-4 w-4" />
                  New list
                </Button>
              }
            />
          }
        />
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create a list</DialogTitle>
            <DialogDescription>
              A name you'll recognise when picking a broadcast audience.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="list-name">Name</Label>
              <Input
                id="list-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Spring offer"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={createList.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createList.isPending}>
                {createList.isPending ? 'Creating…' : 'Create list'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
