import type { RenderContext } from './renderBlocks';

/**
 * Sample merge data for the editor's live preview. The `send-test-email`
 * edge function holds its own copy of the same values — keep the two in
 * step so "Send me a test" matches what the preview shows.
 */
export const SAMPLE_CTX: RenderContext = {
  first_name: 'Sophie',
  customer_name: 'Sophie Taylor',
  template_name: 'Baby & Child First Aid Class',
  event_date: 'Saturday 12 September 2026',
  start_time: '10:00',
  venue: "St Mary's Community Hall",
  franchisee_name: 'Jenni',
  franchisee_email: 'jenni@daisyfirstaid.com',
  booking_reference: 'DFA-SAMPLE',
  unsubscribe_url: 'https://example.com/unsubscribe',
};
