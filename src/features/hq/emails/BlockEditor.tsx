/**
 * Reusable email block editor, extracted from EmailEditorPage so the
 * journey editor and the broadcast composer share one implementation.
 * Owns the "Blocks" heading row, the block cards (with move/insert/delete
 * controls), the add-block menu and the media-library picker dialog.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
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
import type { EmailBlock } from './renderBlocks';
import { MediaGrid } from './MediaGrid';

type BlockType = EmailBlock['type'];

const BLOCK_LABELS: Record<BlockType, string> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  image: 'Image',
  button: 'Button',
  list: 'List',
  divider: 'Divider',
};

const BLOCK_TYPES: BlockType[] = ['heading', 'paragraph', 'image', 'button', 'list', 'divider'];

const FORMATTING_HELP = 'Formatting: **bold**, *italic*, [link text](https://…)';

/** Matches the raw textarea styling used on the Templates page. */
const TEXTAREA_CLASS =
  'border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none';

function newBlock(type: BlockType): EmailBlock {
  switch (type) {
    case 'heading':
      return { type: 'heading', text: '' };
    case 'paragraph':
      return { type: 'paragraph', text: '' };
    case 'image':
      return { type: 'image', src: '' };
    case 'button':
      return { type: 'button', label: '', url: '' };
    case 'list':
      return { type: 'list', items: [''] };
    case 'divider':
      return { type: 'divider' };
  }
}

interface BlockEditorProps {
  blocks: EmailBlock[];
  onChange: (next: EmailBlock[]) => void;
}

export function BlockEditor({ blocks, onChange }: BlockEditorProps) {
  /** Index of the image block currently choosing from the media library. */
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  const updateBlock = (index: number, next: EmailBlock) => {
    onChange(blocks.map((b, i) => (i === index ? next : b)));
  };

  const moveBlock = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= blocks.length) return;
    const copy = [...blocks];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    onChange(copy);
  };

  const removeBlock = (index: number) => {
    onChange(blocks.filter((_, i) => i !== index));
  };

  const insertBlock = (index: number, type: BlockType) => {
    const copy = [...blocks];
    copy.splice(index, 0, newBlock(type));
    onChange(copy);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-daisy-ink text-lg font-bold">Blocks</h2>
        <AddBlockMenu label="Add block" onAdd={(type) => insertBlock(blocks.length, type)} />
      </div>

      {blocks.length === 0 ? (
        <p className="text-daisy-muted text-sm">
          This email has no blocks yet. Use &ldquo;Add block&rdquo; to start building it.
        </p>
      ) : (
        blocks.map((block, index) => (
          <BlockCard
            key={index}
            block={block}
            index={index}
            count={blocks.length}
            onChange={(next) => updateBlock(index, next)}
            onMove={(dir) => moveBlock(index, dir)}
            onRemove={() => removeBlock(index)}
            onAddAfter={(type) => insertBlock(index + 1, type)}
            onPickImage={() => setPickerIndex(index)}
          />
        ))
      )}

      {/* Image picker dialog */}
      <Dialog
        open={pickerIndex !== null}
        onOpenChange={(next) => (!next ? setPickerIndex(null) : null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Choose an image</DialogTitle>
            <DialogDescription>
              Pick from the email-assets library, or upload something new.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <MediaGrid
              onSelect={(url) => {
                if (pickerIndex !== null) {
                  const block = blocks[pickerIndex];
                  if (block?.type === 'image') {
                    updateBlock(pickerIndex, { ...block, src: url });
                  }
                }
                setPickerIndex(null);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface BlockCardProps {
  block: EmailBlock;
  index: number;
  count: number;
  onChange: (next: EmailBlock) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onAddAfter: (type: BlockType) => void;
  onPickImage: () => void;
}

function BlockCard({
  block,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  onAddAfter,
  onPickImage,
}: BlockCardProps) {
  return (
    <div className="border-daisy-line-soft bg-daisy-paper shadow-card rounded-[12px] border">
      <div className="border-daisy-line-soft flex items-center justify-between gap-2 border-b px-4 py-2">
        <span className="text-daisy-muted text-[11px] font-bold tracking-[0.08em] uppercase">
          {BLOCK_LABELS[block.type]}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`Move ${BLOCK_LABELS[block.type]} block up`}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label={`Move ${BLOCK_LABELS[block.type]} block down`}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <AddBlockMenu compact onAdd={onAddAfter} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={onRemove}
            aria-label={`Delete ${BLOCK_LABELS[block.type]} block`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <BlockControls block={block} index={index} onChange={onChange} onPickImage={onPickImage} />
      </div>
    </div>
  );
}

function BlockControls({
  block,
  index,
  onChange,
  onPickImage,
}: {
  block: EmailBlock;
  index: number;
  onChange: (next: EmailBlock) => void;
  onPickImage: () => void;
}) {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return (
        <div className="flex flex-col gap-1.5">
          <textarea
            rows={block.type === 'heading' ? 2 : 4}
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            className={TEXTAREA_CLASS}
            aria-label={`${BLOCK_LABELS[block.type]} text`}
          />
          <p className="text-daisy-muted text-xs">{FORMATTING_HELP}</p>
        </div>
      );
    case 'image':
      return (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`block-${index}-src`}>Image URL</Label>
            <div className="flex gap-2">
              <Input
                id={`block-${index}-src`}
                value={block.src}
                onChange={(e) => onChange({ ...block, src: e.target.value })}
                placeholder="https://…"
              />
              <Button type="button" variant="outline" size="sm" onClick={onPickImage}>
                Choose from library
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`block-${index}-alt`}>Alt text</Label>
              <Input
                id={`block-${index}-alt`}
                value={block.alt ?? ''}
                onChange={(e) =>
                  onChange({ ...block, alt: e.target.value ? e.target.value : undefined })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`block-${index}-width`}>Width (px, max 560)</Label>
              <Input
                id={`block-${index}-width`}
                type="number"
                min="1"
                max="560"
                step="1"
                value={block.width ?? ''}
                onChange={(e) =>
                  onChange({
                    ...block,
                    width: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`block-${index}-href`}>Link URL (optional)</Label>
            <Input
              id={`block-${index}-href`}
              value={block.href ?? ''}
              onChange={(e) =>
                onChange({ ...block, href: e.target.value ? e.target.value : undefined })
              }
              placeholder="https://…"
            />
          </div>
        </>
      );
    case 'button':
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`block-${index}-label`}>Label</Label>
            <Input
              id={`block-${index}-label`}
              value={block.label}
              onChange={(e) => onChange({ ...block, label: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`block-${index}-url`}>URL</Label>
            <Input
              id={`block-${index}-url`}
              value={block.url}
              onChange={(e) => onChange({ ...block, url: e.target.value })}
              placeholder="https://…"
            />
          </div>
        </div>
      );
    case 'list':
      return (
        <div className="flex flex-col gap-1.5">
          <textarea
            rows={Math.max(3, block.items.length + 1)}
            value={block.items.join('\n')}
            onChange={(e) => onChange({ ...block, items: e.target.value.split('\n') })}
            className={TEXTAREA_CLASS}
            aria-label="List items"
          />
          <p className="text-daisy-muted text-xs">One item per line. {FORMATTING_HELP}</p>
        </div>
      );
    case 'divider':
      return <p className="text-daisy-muted text-xs">A horizontal rule. Nothing to configure.</p>;
  }
}

/**
 * Small click-outside menu of the six block types. Follows the manual
 * menu pattern from HQLayout's UserMenu rather than pulling in a new
 * Radix dropdown dependency.
 */
function AddBlockMenu({
  onAdd,
  label,
  compact = false,
}: {
  onAdd: (type: BlockType) => void;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant={compact ? 'ghost' : 'outline'}
        size="sm"
        className={compact ? 'h-7 px-2' : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ?? 'Add block after this one'}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        {label}
      </Button>
      {open ? (
        <div
          role="menu"
          className="border-daisy-line-soft bg-daisy-paper shadow-lift absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-[10px] border"
        >
          {BLOCK_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onAdd(type);
              }}
              className="text-daisy-ink hover:bg-daisy-primary-tint block w-full px-3 py-2 text-left text-sm font-semibold"
            >
              {BLOCK_LABELS[type]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
