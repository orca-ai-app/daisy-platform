import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Images, Trash2, Upload } from 'lucide-react';
import { EmptyState } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDeleteEmailAsset,
  useEmailAssets,
  useUploadEmailAsset,
  type MediaAsset,
} from './queries';

interface MediaGridProps {
  /**
   * When supplied the grid becomes a picker: each tile gains a "Use"
   * button (and the thumbnail itself is clickable) that hands back the
   * asset's public URL. The editor's image dialog uses this; the media
   * library page omits it.
   */
  onSelect?: (url: string) => void;
}

/**
 * Grid over the public `email-assets` bucket: search, upload, copy-URL
 * and delete, shared between the media library page and the editor's
 * image-picker dialog.
 */
export function MediaGrid({ onSelect }: MediaGridProps) {
  const assets = useEmailAssets();
  const upload = useUploadEmailAsset();
  const remove = useDeleteEmailAsset();
  const [search, setSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = assets.data ?? [];
    return q ? rows.filter((a) => a.name.toLowerCase().includes(q)) : rows;
  }, [assets.data, search]);

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    try {
      const name = await upload.mutateAsync(file);
      toast.success(`${name} uploaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const handleCopy = async (asset: MediaAsset) => {
    try {
      await navigator.clipboard.writeText(asset.publicUrl);
      toast.success('URL copied to clipboard');
    } catch {
      toast.error('Could not copy the URL');
    }
  };

  const handleDelete = async (asset: MediaAsset) => {
    // Plain web app, so window.confirm is fine here (unlike the Tauri webview).
    if (
      !window.confirm(
        `Delete ${asset.name}? Any email still referencing it will show a broken image.`,
      )
    ) {
      return;
    }
    try {
      await remove.mutateAsync(asset.name);
      toast.success(`${asset.name} deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search media by name"
          className="h-10 max-w-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
        >
          <Upload className="h-4 w-4" />
          {upload.isPending ? 'Uploading…' : 'Upload image'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handleUpload(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        {assets.data ? (
          <span className="text-daisy-muted text-xs font-semibold">
            {filtered.length} of {assets.data.length} image{assets.data.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {assets.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-[10px]" />
          ))}
        </div>
      ) : assets.isError ? (
        <p className="text-daisy-orange text-sm">Failed to load media: {assets.error.message}</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Images />}
          title={search.trim() ? 'No images match your search' : 'No images yet'}
          body={
            search.trim()
              ? 'Try a different name, or clear the search.'
              : 'Upload an image to make it available to the journey emails.'
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((asset) => (
            <div
              key={asset.name}
              className="border-daisy-line-soft bg-daisy-paper flex flex-col overflow-hidden rounded-[10px] border"
            >
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(asset.publicUrl)}
                  className="bg-daisy-bg hover:bg-daisy-primary-tint block w-full transition-colors"
                  aria-label={`Use ${asset.name}`}
                >
                  <img
                    src={asset.publicUrl}
                    alt={asset.name}
                    loading="lazy"
                    className="h-28 w-full object-contain"
                  />
                </button>
              ) : (
                <div className="bg-daisy-bg">
                  <img
                    src={asset.publicUrl}
                    alt={asset.name}
                    loading="lazy"
                    className="h-28 w-full object-contain"
                  />
                </div>
              )}
              <div className="flex flex-col gap-1.5 p-2">
                <span className="text-daisy-ink truncate text-xs font-semibold" title={asset.name}>
                  {asset.name}
                </span>
                <div className="flex items-center gap-1">
                  {onSelect ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => onSelect(asset.publicUrl)}
                    >
                      Use
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => void handleCopy(asset)}
                    aria-label={`Copy URL for ${asset.name}`}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => void handleDelete(asset)}
                    disabled={remove.isPending}
                    aria-label={`Delete ${asset.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
