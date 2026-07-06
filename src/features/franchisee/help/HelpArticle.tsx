/**
 * /franchisee/help/:slug — renders a single help article.
 *
 * Back link, title, sections (body paragraphs and/or ordered steps list),
 * related links, and optional video guide notice.
 */

import { Link, useParams } from 'react-router';
import { BookOpen } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/daisy';
import { findArticle } from './articles';

// ---------------------------------------------------------------------------
// Section renderer
// ---------------------------------------------------------------------------

function ArticleSection({
  heading,
  body,
  steps,
}: {
  heading?: string;
  body?: string[];
  steps?: string[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {heading ? (
        <h2 className="font-display text-daisy-ink text-[18px] font-bold">{heading}</h2>
      ) : null}
      {body?.map((paragraph, i) => (
        <p key={i} className="text-daisy-ink text-sm leading-relaxed">
          {paragraph}
        </p>
      ))}
      {steps && steps.length > 0 ? (
        <ol className="flex flex-col gap-2 pl-1">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <span className="bg-daisy-primary mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white">
                {i + 1}
              </span>
              <span className="text-daisy-ink leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function HelpArticle() {
  const { slug } = useParams<{ slug: string }>();
  const article = slug ? findArticle(slug) : undefined;

  if (!article) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          to="/franchisee/help"
          className="text-daisy-primary inline-flex items-center gap-1 text-sm font-semibold hover:underline"
        >
          ← All guides
        </Link>
        <EmptyState
          icon={<BookOpen />}
          title="Guide not found"
          body="This guide may have moved or the link is incorrect."
          cta={{ label: '← All guides', href: '/franchisee/help' }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/franchisee/help"
        className="text-daisy-primary inline-flex items-center gap-1 text-sm font-semibold hover:underline"
      >
        ← All guides
      </Link>

      <PageHeader title={article.title} />

      <div className="flex flex-col gap-8 max-w-2xl">
        {article.sections.map((section, i) => (
          <ArticleSection
            key={i}
            heading={section.heading}
            body={section.body}
            steps={section.steps}
          />
        ))}

        {article.videoUrl ? (
          <p className="text-daisy-muted text-sm italic">Video guide coming soon.</p>
        ) : null}

        {article.related && article.related.length > 0 ? (
          <div className="border-daisy-line flex flex-col gap-3 border-t pt-6">
            <h3 className="font-display text-daisy-ink text-[15px] font-bold">Related guides</h3>
            <ul className="flex flex-col gap-1.5">
              {article.related.map((relatedSlug) => {
                const related = findArticle(relatedSlug);
                if (!related) return null;
                return (
                  <li key={relatedSlug}>
                    <Link
                      to={`/franchisee/help/${relatedSlug}`}
                      className="text-daisy-primary text-sm font-semibold hover:underline"
                    >
                      {related.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
