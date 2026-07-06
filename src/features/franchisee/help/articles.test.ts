/**
 * Integrity checks for the help articles data.
 *
 * Ensures uniqueness, cross-reference validity, and content completeness.
 */

import { describe, it, expect } from 'vitest';
import { HELP_ARTICLES, findArticle } from './articles';

describe('HELP_ARTICLES integrity', () => {
  it('has at least one article', () => {
    expect(HELP_ARTICLES.length).toBeGreaterThan(0);
  });

  it('all slugs are unique', () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it('every article has at least one section', () => {
    for (const article of HELP_ARTICLES) {
      expect(article.sections.length, `${article.slug} must have at least one section`).toBeGreaterThan(0);
    }
  });

  it('every related slug resolves to an existing article', () => {
    for (const article of HELP_ARTICLES) {
      for (const rel of article.related ?? []) {
        expect(
          findArticle(rel),
          `${article.slug} has related slug "${rel}" which does not exist`,
        ).toBeDefined();
      }
    }
  });

  it('all search-relevant fields are non-empty', () => {
    for (const article of HELP_ARTICLES) {
      expect(article.title.trim(), `${article.slug} title must be non-empty`).not.toBe('');
      expect(article.summary.trim(), `${article.slug} summary must be non-empty`).not.toBe('');
      expect(
        article.keywords.length,
        `${article.slug} must have at least one keyword`,
      ).toBeGreaterThan(0);
      for (const kw of article.keywords) {
        expect(kw.trim(), `${article.slug} keyword must be non-empty`).not.toBe('');
      }
    }
  });

  it('every section has body or steps (or both)', () => {
    for (const article of HELP_ARTICLES) {
      for (const [i, section] of article.sections.entries()) {
        const hasContent =
          (section.body !== undefined && section.body.length > 0) ||
          (section.steps !== undefined && section.steps.length > 0);
        expect(
          hasContent,
          `${article.slug} section[${i}] must have body or steps`,
        ).toBe(true);
      }
    }
  });
});

describe('findArticle helper', () => {
  it('returns the article for a valid slug', () => {
    const article = findArticle('getting-started');
    expect(article).toBeDefined();
    expect(article?.slug).toBe('getting-started');
  });

  it('returns undefined for an unknown slug', () => {
    expect(findArticle('does-not-exist')).toBeUndefined();
  });
});
