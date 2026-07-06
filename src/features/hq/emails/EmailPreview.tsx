/**
 * Sticky live preview of an email built from blocks, rendered with the
 * exact same renderBlocks pipeline the send functions use, filled with
 * SAMPLE_CTX. Extracted from EmailEditorPage so the journey editor and
 * the broadcast composer share one implementation.
 */

import { useMemo } from 'react';
import { renderBlocks, type EmailBlock } from './renderBlocks';
import { SAMPLE_CTX } from './sampleContext';

interface EmailPreviewProps {
  blocks: EmailBlock[];
  preheader: string;
}

export function EmailPreview({ blocks, preheader }: EmailPreviewProps) {
  const previewHtml = useMemo(
    () => renderBlocks(blocks, SAMPLE_CTX, preheader.trim() ? preheader.trim() : undefined).html,
    [blocks, preheader],
  );

  return (
    <div className="flex flex-col gap-2 self-start lg:sticky lg:top-6">
      <p className="text-daisy-muted text-[12px] font-bold tracking-[0.08em] uppercase">
        Live preview (sample data)
      </p>
      <iframe
        title="Email preview"
        srcDoc={previewHtml}
        sandbox=""
        className="border-daisy-line-soft h-[720px] w-full rounded-[12px] border bg-white"
      />
    </div>
  );
}
