# M2 Handover

**For:** Jenni Dunman
**From:** Chris Simmance
**Date:** End of Week 9

---

### What you got in M2

The franchisee portal. Ashley can now log in and run his business through the platform without touching a spreadsheet.

Specifically, a franchisee can:

- Land on their own dashboard showing upcoming courses, bookings this month, revenue this month, and outstanding capacity. All data is scoped to their own records; they cannot see any other franchisee's numbers.
- View their territories on a map and see course count and revenue per territory for the current month. Request a new territory via a one-click email to you.
- Browse, filter, and sort their course instances in a list view or a month calendar. Click any course to see the full detail.
- Create a new course in five steps: pick a template, set the date and venue, confirm pricing and capacity, choose public or private visibility, and review before saving. The platform geocodes the postcode, checks territory ownership, and requires an explicit confirmation tick if the postcode is outside their assigned area.
- View a course detail page showing all the course's information, ticket types, and an audit timeline of every change.
- Add, edit, and delete ticket types (Single, Couple, Family, or anything else) on any of their courses.
- Edit a course's date, time, venue, capacity, or price after it has been created.
- Cancel a course with a reason, which is stamped on the record and activity-logged.
- Manage a private client directory: schools, nurseries, companies, and other organisations they run courses for. Add, edit, and search clients. Link a private client to a private course when creating it.
- Create and manage discount codes: percentage or fixed-amount, with optional usage caps and expiry dates. Ready for validation when the public booking widget launches in M3.
- Edit their own name and phone number. Email and fee tier remain yours to control.
- Sign out from an avatar dropdown in the top right.

The portal is mobile-responsive. On a phone, navigation moves to a bottom bar; on desktop, it sits in the top bar. An error boundary catches any page-level failures and shows a friendly message instead of a blank screen.

Every change made through the portal is recorded in the activity log.

---

### What is parked (Wave 8 - Stripe payments and bookings list)

Two features are complete in terms of build plan but held back pending one external dependency: Stripe test-mode credentials.

**Wave 8 - Stripe Connect and Payment Links.** Ashley needs to connect his Stripe account to the platform so the system can generate payment links for private courses, route money to his bank, and take the platform fee automatically. The tab is visible in the nav but shows a holding state. This unblocks the moment you provide:

1. `STRIPE_SECRET_KEY` (test mode, from your Stripe dashboard)
2. `STRIPE_WEBHOOK_SECRET` (from the webhook endpoint registration in Stripe)

Steps are in `docs/stripe-connect-setup.md`. Estimated time to complete: under 30 minutes on your side. Once those two keys are in Supabase secrets, Wave 8 takes roughly one week to wire up.

**Wave 9A - Franchisee bookings list.** The full bookings list for franchisees (filterable, with mark-as-paid for cheque bookings) depends on real booking rows existing from Stripe webhooks. It is designed and ready to build but is sequenced after Wave 8 so Ashley has actual bookings to look at. The seed data gives the dashboard KPI cards data; the dedicated list view ships with Wave 8.

Nothing else is blocked. Waves 6, 7, 9B, 9C, and 9D all shipped in full.

---

### What M3 will add

M3 (weeks 10-13) is the public-facing half of the platform. It is what parents see.

- The public booking widget on `daisyfirstaid.com`. Parents find courses by postcode, select a date, choose a ticket type, and pay via Stripe. The booking appears in Ashley's portal immediately.
- The QR-code medical declaration form. Parents fill it in on their phone at the door. No paper.
- Email sequences: booking confirmation to the parent, new-booking notification to the franchisee, post-course thank-you, refresher reminders at 6 and 12 months.
- BookWhen and Kartra are switched off the day M3 goes live.

M3 invoice (~£5,000) fires when the public booking cutover is done.

---

### What we need from you to start M3

Three things, ideally within a week of this sign-off:

1. **Stripe credentials.** The two keys from `docs/stripe-connect-setup.md`. These unblock Wave 8 first, then the M3 Stripe work uses the same setup. If you haven't started the Stripe platform account yet, this is the one with a potential KYC lead time, so earlier is better.
2. **Confirmation of the beta franchisee list.** Names and emails for the franchisees who will test the public booking widget before the full network goes live. Ashley is already provisioned; who are the next four?
3. **One short call.** Half an hour before M3 build starts. The public booking widget has a few UX decisions (what parents see, what fields are required, how the course finder works) that are best confirmed verbally before the build locks them in.

---

### Sign-off

If the demo matched what you wanted, the words I need from you are:

> "Approved. Start M3."

If there's anything you want changed first, list it in your reply. Small copy or layout changes this week. Anything bigger we'll scope together.

The M2 invoice (~£6,000, per the kick-off agreement) follows your sign-off email.

Thank you for your patience through the Stripe hold. The platform is in genuinely good shape and M3 has a clear path.

Chris
