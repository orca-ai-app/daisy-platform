/**
 * Barrel exports for the franchisee help feature.
 */

export { default as HelpIndex } from './HelpIndex';
export { default as HelpArticle } from './HelpArticle';
export type { HelpSection, HelpArticle as HelpArticleType } from './articles';
export { HELP_ARTICLES, findArticle } from './articles';
