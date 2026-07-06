/**
 * Email list detail: inline rename, member table, add-member form and a
 * client-side CSV import (papaparse) with an added/skipped/invalid report.
 *
 * Import rules: headers matched case-insensitively (email required;
 * first_name/firstname/first and last_name/lastname/last accepted; extra
 * columns ignored), emails trimmed + lowercased, deduplicated within the
 * file and against existing members, then inserted in 500-row chunks.
 */

import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { ArrowLeft, Check, Pencil, Trash2, Upload, UserPlus, X } from 'lucide-react';
import { DataTable, EmptyState, PageHeader } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmailSectionTabs } from './EmailSectionTabs';
import {
  useAddListMember,
  useDeleteListMember,
  useEmailList,
  useImportListMembers,
  useListMembers,
  useRenameEmailList,
  type EmailListMember,
  type ImportMemberRow,
} from './queries';
import { formatDate } from './broadcastHelpers';

/** Simple RFC-ish check — the send pipeline is the real gatekeeper. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_INVALID_SHOWN = 50;

const memberSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  first_name: z.string().trim().optional(),
  last_name: z.string().trim().optional(),
});

type MemberFormValues = z.infer<typeof memberSchema>;

interface InvalidRow {
  line: number;
  value: string;
  reason: string;
}

interface ImportReport {
  added: number;
  duplicates: number;
  invalid: InvalidRow[];
  invalidTotal: number;
}

/** Normalise a CSV header for matching: lowercase, strip spaces/underscores/hyphens. */
function normaliseHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

const EMAIL_HEADERS = ['email', 'emailaddress'];
const FIRST_HEADERS = ['firstname', 'first'];
const LAST_HEADERS = ['lastname', 'last'];

export default function ListDetailPage() {
  const { id } = useParams<{ id: string }>();

  const list = useEmailList(id);
  const members = useListMembers(id);

  const renameList = useRenameEmailList();
  const addMember = useAddListMember();
  const deleteMember = useDeleteListMember();
  const importMembers = useImportListMembers();

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MemberFormValues>({
    resolver: zodResolver(memberSchema),
    defaultValues: { email: '', first_name: '', last_name: '' },
  });

  const handleRename = async () => {
    const name = nameDraft.trim();
    if (!id || !name) {
      toast.error('The list name cannot be empty.');
      return;
    }
    try {
      await renameList.mutateAsync({ id, name });
      setEditingName(false);
      toast.success('List renamed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
    }
  };

  const onAddMember = async (values: MemberFormValues) => {
    if (!id) return;
    try {
      await addMember.mutateAsync({
        list_id: id,
        email: values.email,
        first_name: values.first_name?.trim() ? values.first_name.trim() : null,
        last_name: values.last_name?.trim() ? values.last_name.trim() : null,
      });
      reset();
      toast.success(`${values.email.trim().toLowerCase()} added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Add failed');
    }
  };

  const handleDeleteMember = async (member: EmailListMember) => {
    if (!id) return;
    try {
      await deleteMember.mutateAsync({ id: member.id, list_id: id });
      toast.success(`${member.email} removed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remove failed');
    }
  };

  const handleFile = (file: File) => {
    if (!id || !members.data) return;
    setReport(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: normaliseHeader,
      complete: (result) => {
        const fields = result.meta.fields ?? [];
        const emailField = fields.find((f) => EMAIL_HEADERS.includes(f));
        if (!emailField) {
          toast.error('No email column found. The CSV needs a header called "email".');
          return;
        }
        const firstField = fields.find((f) => FIRST_HEADERS.includes(f));
        const lastField = fields.find((f) => LAST_HEADERS.includes(f));

        const seen = new Set((members.data ?? []).map((m) => m.email.toLowerCase()));
        const toInsert: ImportMemberRow[] = [];
        let duplicates = 0;
        const invalid: InvalidRow[] = [];
        let invalidTotal = 0;

        result.data.forEach((row, i) => {
          const line = i + 2; // header is line 1
          const raw = (row[emailField] ?? '').trim();
          if (!raw) {
            invalidTotal += 1;
            if (invalid.length < MAX_INVALID_SHOWN) {
              invalid.push({ line, value: '(empty)', reason: 'Missing email' });
            }
            return;
          }
          const email = raw.toLowerCase();
          if (!EMAIL_RE.test(email)) {
            invalidTotal += 1;
            if (invalid.length < MAX_INVALID_SHOWN) {
              invalid.push({ line, value: raw, reason: 'Invalid email address' });
            }
            return;
          }
          if (seen.has(email)) {
            duplicates += 1;
            return;
          }
          seen.add(email);
          toInsert.push({
            email,
            first_name: firstField && row[firstField]?.trim() ? row[firstField].trim() : null,
            last_name: lastField && row[lastField]?.trim() ? row[lastField].trim() : null,
          });
        });

        const finish = (added: number) => {
          setReport({ added, duplicates, invalid, invalidTotal });
          toast.success(
            `Import finished: ${added} added, ${duplicates} duplicate${duplicates === 1 ? '' : 's'} skipped, ${invalidTotal} invalid`,
          );
        };

        if (toInsert.length === 0) {
          finish(0);
          return;
        }
        importMembers
          .mutateAsync({ list_id: id, rows: toInsert })
          .then((added) => finish(added))
          .catch((err: unknown) => {
            toast.error(err instanceof Error ? err.message : 'Import failed');
          });
      },
      error: (err) => {
        toast.error(`Could not read that file: ${err.message}`);
      },
    });
  };

  const columns = useMemo<ColumnDef<EmailListMember>[]>(
    () => [
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => <span className="font-semibold">{row.original.email}</span>,
      },
      {
        accessorKey: 'first_name',
        header: 'First name',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft text-[13px]">{row.original.first_name ?? '-'}</span>
        ),
      },
      {
        accessorKey: 'last_name',
        header: 'Last name',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft text-[13px]">{row.original.last_name ?? '-'}</span>
        ),
      },
      {
        accessorKey: 'created_at',
        header: 'Added',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">
            {formatDate(row.original.created_at)}
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
            aria-label={`Remove ${row.original.email}`}
            onClick={() => void handleDeleteMember(row.original)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  if (list.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  if (list.isError || !list.data) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-daisy-orange text-sm">
          Failed to load this list: {list.error?.message ?? 'not found'}
        </p>
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link to="/hq/emails/lists">
            <ArrowLeft className="h-4 w-4" />
            Back to lists
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link to="/hq/emails/lists" className="hover:text-daisy-primary transition-colors">
            Lists
          </Link>
        }
        title={
          editingName ? (
            <span className="flex items-center gap-2">
              <Input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRename();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                className="max-w-xs"
                aria-label="List name"
                autoFocus
              />
              <Button
                type="button"
                size="sm"
                onClick={() => void handleRename()}
                disabled={renameList.isPending}
                aria-label="Save list name"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditingName(false)}
                aria-label="Cancel rename"
              >
                <X className="h-4 w-4" />
              </Button>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {list.data.name}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => {
                  setNameDraft(list.data.name);
                  setEditingName(true);
                }}
                aria-label="Rename list"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </span>
          )
        }
        subtitle={`${list.data.member_count} member${list.data.member_count === 1 ? '' : 's'}. Duplicate emails are skipped automatically.`}
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                // Allow re-selecting the same file.
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={importMembers.isPending || members.isLoading}
            >
              <Upload className="h-4 w-4" />
              {importMembers.isPending ? 'Importing…' : 'Import CSV'}
            </Button>
          </>
        }
      />
      <EmailSectionTabs />

      {/* Import report */}
      {report ? (
        <div className="border-daisy-line-soft bg-daisy-paper shadow-card flex flex-col gap-2 rounded-[12px] border p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-daisy-ink text-lg font-bold">Import report</h2>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setReport(null)}>
              <X className="h-3.5 w-3.5" />
              Dismiss
            </Button>
          </div>
          <p className="text-sm font-semibold">
            <span className="text-[#2F6F4F]">{report.added} added</span>
            <span className="text-daisy-muted"> · </span>
            <span className="text-daisy-muted">{report.duplicates} duplicates skipped</span>
            <span className="text-daisy-muted"> · </span>
            <span className={report.invalidTotal > 0 ? 'text-[#8A2A2A]' : 'text-daisy-muted'}>
              {report.invalidTotal} invalid
            </span>
          </p>
          {report.invalid.length > 0 ? (
            <div className="border-daisy-line max-h-56 overflow-y-auto rounded-[8px] border border-dashed p-3">
              <ul className="flex flex-col gap-1 text-[13px]">
                {report.invalid.map((r) => (
                  <li key={`${r.line}-${r.value}`} className="text-daisy-ink-soft">
                    Line {r.line}: <span className="font-mono">{r.value}</span>{' '}
                    <span className="text-daisy-muted">— {r.reason}</span>
                  </li>
                ))}
              </ul>
              {report.invalidTotal > report.invalid.length ? (
                <p className="text-daisy-muted mt-2 text-xs">
                  …and {report.invalidTotal - report.invalid.length} more invalid row
                  {report.invalidTotal - report.invalid.length === 1 ? '' : 's'} not shown.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Add member */}
      <div className="border-daisy-line-soft bg-daisy-paper shadow-card flex flex-col gap-3 rounded-[12px] border p-4">
        <h2 className="font-display text-daisy-ink text-lg font-bold">Add a member</h2>
        <form
          onSubmit={(e) => {
            void handleSubmit(onAddMember)(e);
          }}
          className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-email">Email</Label>
            <Input id="member-email" placeholder="name@example.com" {...register('email')} />
            {errors.email ? (
              <p className="text-daisy-orange text-xs">{errors.email.message}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-first">First name</Label>
            <Input id="member-first" {...register('first_name')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-last">Last name</Label>
            <Input id="member-last" {...register('last_name')} />
          </div>
          <Button type="submit" disabled={addMember.isPending}>
            <UserPlus className="h-4 w-4" />
            {addMember.isPending ? 'Adding…' : 'Add'}
          </Button>
        </form>
      </div>

      {/* Members */}
      {members.isError ? (
        <p className="text-daisy-orange text-sm">Failed to load members: {members.error.message}</p>
      ) : (
        <DataTable<EmailListMember>
          columns={columns}
          data={members.data ?? []}
          isLoading={members.isLoading}
          searchPlaceholder="Search by email…"
          pageSize={50}
          emptyState={
            <EmptyState
              icon={<UserPlus />}
              title="No members yet"
              body="Add people with the form above, or import a CSV with email, first_name and last_name columns."
            />
          }
        />
      )}
    </div>
  );
}
