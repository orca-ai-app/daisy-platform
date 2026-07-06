import { PageHeader } from '@/components/daisy';
import { EmailSectionTabs } from './EmailSectionTabs';
import { MediaGrid } from './MediaGrid';

export default function MediaLibraryPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Media library"
        subtitle="Images available to the journey and broadcast emails. The bucket is publicly readable — anything uploaded here is visible to anyone with the link."
      />
      <EmailSectionTabs />
      <MediaGrid />
    </div>
  );
}
