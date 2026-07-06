import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, Send } from 'lucide-react';
import { PageHeader } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/features/auth/RoleContext';
import type { EmailBlock } from './renderBlocks';
import { BlockEditor } from './BlockEditor';
import { EmailPreview } from './EmailPreview';
import {
  useEmailTemplate,
  useSendTestEmail,
  useUpdateEmailTemplate,
  type EmailTemplate,
} from './queries';

export default function EmailEditorPage() {
  const { templateKey } = useParams<{ templateKey: string }>();
  const template = useEmailTemplate(templateKey);

  if (template.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-12 w-1/2" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-[560px] w-full" />
          <Skeleton className="h-[560px] w-full" />
        </div>
      </div>
    );
  }

  if (template.isError || !template.data) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-daisy-orange text-sm">
          Failed to load this email: {template.error?.message ?? 'not found'}
        </p>
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link to="/hq/emails">
            <ArrowLeft className="h-4 w-4" />
            Back to emails
          </Link>
        </Button>
      </div>
    );
  }

  // Key on the row id so the editor state resets if the route changes template.
  return <EmailEditor key={template.data.id} template={template.data} />;
}

function EmailEditor({ template }: { template: EmailTemplate }) {
  const navigate = useNavigate();
  const { franchisee } = useRole();
  const updateTemplate = useUpdateEmailTemplate();
  const sendTest = useSendTestEmail();

  const [subject, setSubject] = useState(template.subject);
  const [preheader, setPreheader] = useState(template.preheader ?? '');
  const [blocks, setBlocks] = useState<EmailBlock[]>(template.blocks);

  const dirty =
    subject !== template.subject ||
    preheader !== (template.preheader ?? '') ||
    JSON.stringify(blocks) !== JSON.stringify(template.blocks);

  // Warn on tab close / hard navigation while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const handleBack = () => {
    // Plain web app, so window.confirm is fine here (not the Tauri webview).
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    void navigate('/hq/emails');
  };

  const handleSave = async () => {
    try {
      await updateTemplate.mutateAsync({
        id: template.id,
        subject: subject.trim(),
        preheader: preheader.trim() ? preheader.trim() : null,
        blocks,
        updated_by: franchisee?.id ?? null,
      });
      toast.success(`${template.name} saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleSendTest = async () => {
    try {
      const { sentTo } = await sendTest.mutateAsync(template.template_key);
      toast.success(`Test email sent to ${sentTo}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test send failed');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <button
            type="button"
            onClick={handleBack}
            className="hover:text-daisy-primary transition-colors"
          >
            ← Emails
          </button>
        }
        title={template.name}
        subtitle={
          template.delay_label
            ? `Sends ${template.delay_label}. The timing is fixed; the content below is yours to edit.`
            : 'The timing is fixed; the content below is yours to edit.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSendTest()}
              disabled={sendTest.isPending}
            >
              <Send className="h-4 w-4" />
              {sendTest.isPending ? 'Sending…' : 'Send me a test'}
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={!dirty || updateTemplate.isPending}
            >
              {updateTemplate.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </Button>
          </div>
        }
      />

      {dirty ? (
        <p className="text-daisy-muted -mt-4 text-xs font-semibold">
          Unsaved changes. &ldquo;Send me a test&rdquo; sends the last saved version.
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        {/* Left: editing controls */}
        <div className="flex flex-col gap-4">
          <div className="border-daisy-line-soft bg-daisy-paper shadow-card flex flex-col gap-4 rounded-[12px] border p-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-preheader">Preheader</Label>
              <Input
                id="email-preheader"
                value={preheader}
                onChange={(e) => setPreheader(e.target.value)}
                placeholder="The short line inbox apps show after the subject"
              />
              <p className="text-daisy-muted text-xs">
                Optional. Merge fields like {'{{first_name}}'} work in the subject, preheader and
                every block.
              </p>
            </div>
          </div>

          <BlockEditor blocks={blocks} onChange={setBlocks} />
        </div>

        {/* Right: sticky live preview */}
        <EmailPreview blocks={blocks} preheader={preheader} />
      </div>
    </div>
  );
}
