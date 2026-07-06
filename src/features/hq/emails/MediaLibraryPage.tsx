import { Link } from 'react-router';
import { PageHeader } from '@/components/daisy';
import { MediaGrid } from './MediaGrid';

export default function MediaLibraryPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link to="/hq/emails" className="hover:text-daisy-primary transition-colors">
            Emails
          </Link>
        }
        title="Media library"
        subtitle="Images available to the journey emails. The bucket is publicly readable — anything uploaded here is visible to anyone with the link."
      />
      <MediaGrid />
    </div>
  );
}
