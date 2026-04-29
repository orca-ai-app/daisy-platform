# M1 Handover

**For:** Jenni Dunman
**From:** Chris Simmance
**Date:** Thursday, end of Week 5

---

### What you got in M1

After this milestone, you can:

- Log in at `https://daisy-crm-platform.netlify.app` (your temporary address until cutover) and see the whole network on one screen: bookings, revenue, who's active, where the gaps are.
- Search any franchisee by name, number, or email and see every territory she covers, every course she's run, every booking she's taken, every fee she owes.
- Look at the UK on a map and see which territories are active, which are quiet, and which are vacant. Click an empty one and assign someone to it.
- Run a billing preview for any franchisee in any month and see exactly what they'd be charged. Base fee or 10% of revenue, whichever is higher, broken down per territory.
- Export an accountant-ready CSV or PDF in one click.
- Read an audit log of everything anyone has done in the system, free of charge.

Behind the scenes, the foundation for everything that comes next is in place: the database, the security model, the deployment pipeline, the design system. M2 and M3 build on top, they don't rebuild any of it.

---

### What's coming in M2 (Weeks 6–9)

The franchisee portal. This is what Sarah, Maria, Ashley and the rest will see when they log in.

- Their own dashboard, scoped to their own territories. They cannot see anyone else's data.
- A 5-step form to schedule a public or private course, with postcode geocoding and out-of-territory warnings.
- Stripe Connect onboarding. Each franchisee connects their own bank, money goes to them directly.
- Discount codes and a private client directory.
- Booking notification emails (so Sarah knows the moment a parent books).

M2 invoice (~£6,000) fires when M2 goes live and you have at least one beta franchisee using it for real.

---

### What's coming in M3 (Weeks 10–13)

Public booking goes live. Parents can find courses on `daisyfirstaid.com` and book them directly. Real money. Real bookings.

- The public booking widget that lives on your website.
- The QR-code medical declaration form (no more paper).
- Email sequences for post-course follow-up.
- BookWhen and Kartra get switched off the day this lands.

M3 invoice (~£5,000) fires when the cutover is done.

---

### What we need from you for M2 to start

Three small things, all this week:

1. **Confirm Stripe is progressing.** The one-pager at `docs/stripe-connect-setup.md` lists what Daisy needs to file. It's not hard but has a lead time, so as long as it's started before M2 begins, we're fine.
2. **Pick five beta franchisees.** Real names, real emails. People whose feedback we'll act on first when the franchisee portal lands. Pick people who'll tell you the truth, not just nod.
3. **One short call.** Half an hour, before the build starts. I'll walk you through the franchisee UX so you can flag anything that doesn't match how Sarah actually works.

---

### Sign-off

If everything in this document and the demo matches what you wanted, the words I need from you are simply:

> "Approved. Start M2."

If there's something you want changed first, list it in your reply. Anything small (copy, layout) gets fixed this week. Anything bigger we'll talk about together, and I'll come back with options and a recommendation rather than just a price tag.

Either way, the M1 invoice (£7,000, per the kick-off agreement) follows your sign-off email.

Thank you for trusting me with this.

Chris
