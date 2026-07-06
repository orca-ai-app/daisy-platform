/**
 * /franchisee/help — help index page for franchisees.
 *
 * Renders a list of all help articles with a client-side search filter.
 * Matches against title, summary, keywords, and section body/steps text.
 */

import { useState } from 'react';
import { Link } from 'react-router';
import { CircleHelp } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/daisy';
import { Input } from '@/components/ui/input';
import { HELP_ARTICLES } from './articles';
import type { HelpArticle } from './articles';

// ---------------------------------------------------------------------------
// Search logic — case-insensitive match against all text fields
// ---------------------------------------------------------------------------

function matchesQuery(article: HelpArticle, query: string): boolean {
  const q = query.toLowerCase();
  if (article.title.toLowerCase().includes(q)) return true;
  if (article.summary.toLowerCase().includes(q)) return true;
  if (article.keywords.some((k) => k.toLowerCase().includes(q))) return true;
  for (const section of article.sections) {
    if (section.heading?.toLowerCase().includes(q)) return true;
    if (section.body?.some((b) => b.toLowerCase().includes(q))) return true;
    if (section.steps?.some((s) => s.toLowerCase().includes(q))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Article card
// ---------------------------------------------------------------------------

function ArticleCard({ article }: { article: HelpArticle }) {
  return (
    <Link
      to={`/franchisee/help/${article.slug}`}
      className="border-daisy-line bg-daisy-paper hover:border-daisy-primary flex flex-col gap-1 rounded-[12px] border p-5 transition-colors"
    >
      <h2 className="font-display text-daisy-ink text-[16px] font-bold">{article.title}</h2>
      <p className="text-daisy-muted text-sm">{article.summary}</p>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function HelpIndex() {
  const [query, setQuery] = useState('');

  const filtered =
    query.trim().length === 0
      ? HELP_ARTICLES
      : HELP_ARTICLES.filter((a) => matchesQuery(a, query.trim()));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Help & guides"
        subtitle="Step-by-step guides for using your franchisee portal."
      />

      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search guides…"
        className="max-w-md rounded-full"
        aria-label="Search help guides"
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<CircleHelp />}
          title="No guides match your search"
          body="Try a different search term, or clear the box to see all guides."
          cta={{ label: 'Clear search', onClick: () => setQuery('') }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((article) => (
            <ArticleCard key={article.slug} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}
