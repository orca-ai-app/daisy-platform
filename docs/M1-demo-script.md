# M1 Demo Script

**For:** Thursday demo with Jenni Dunman
**Length:** about 25 minutes
**Format:** live walk-through, Chris driving, Jenni watching, questions welcome at any point

This is the script for the live call. It's written so Chris can keep it open on a second monitor and follow along. Each step has the URL to navigate to, what the screen should look like, and what to say. It is not a script to read out word for word, it is a guardrail.

The aim is simple: show Jenni that what we agreed in the PRD is real, working software she can log into. By the end she should have answered three questions for herself: "is this real, will it be simple enough, and what happens next."

---

## Pre-flight checklist (run 30 minutes before the call)

Tick each one before joining the call. If any fails, fix it before Jenni dials in, not on the call.

- [ ] Sign in at `https://daisy-crm-platform.netlify.app` with `dev@daisyfirstaid.com`. Confirm you land on the HQ dashboard, not a 404 or a blank screen.
- [ ] Confirm the four KPI cards on the dashboard show sensible numbers (bookings MTD, network revenue MTD, active franchisees, territory coverage). If any reads zero, the seed didn't run cleanly.
- [ ] Confirm Netlify is deploying the current `main` HEAD. Quick check: open the deploys list in Netlify, latest deploy should match the latest commit on `main`.
- [ ] Have `docs/M1-build-plan.md` and `docs/PRD-client-facing.md` open in another browser tab so you can reference exact sections if Jenni asks.
- [ ] Click into `/hq/territories` and confirm the Google Map renders with coloured markers. If you see "Map unavailable" the Maps API key isn't loading.
- [ ] Quick smoke test: open `/hq/courses/templates`, change the description on one template, save, then open `/hq/activity` and confirm the change is at the top of the activity log. Revert your change so the demo data isn't dirty.
- [ ] Close every other browser tab and notification source. Mute Slack, mute email, set your phone face down.
- [ ] Have your camera and audio tested. Loom recording set up only if you're recording the live call (separate from the 4-minute Loom that's already done).

---

## The walk-through (9 steps)

### Step 1. The login screen

**Chris does:** Opens a fresh browser tab, navigates to `https://daisy-crm-platform.netlify.app`. Doesn't sign in yet.

**Jenni sees:** A clean Daisy-branded login page. Blue. The yellow dot. Email and password fields. Nothing else.

**Chris says:**
> "Here's the front door. Eventually this will live at `bookings.daisyfirstaid.com`, but for now while we're still building, it's on a temporary address. Same login screen for everyone, HQ and franchisees, the system works out who you are once you're in. There's only one URL and one place to remember."

Wait a beat for Jenni to look. Then move on.

---

### Step 2. The HQ dashboard

**Chris does:** Types in `dev@daisyfirstaid.com` and the password (from the credentials doc), clicks Sign in. Lands on `/hq/dashboard`.

**Jenni sees:** Four KPI cards across the top: Bookings this month, Network revenue this month, Active franchisees, Territory coverage. Below that, an Attention Needed panel and a recent activity feed.

**Chris says:**
> "This is what you'd see Monday morning. Four numbers up top, and they're the four numbers you've told me you actually care about. Bookings across the network this month, what franchisees have collected this month, how many of them are active right now, and how much of the country is covered. No spreadsheet to check, no email to write. It's just here when you log in."

Pause. Let her read the numbers. Don't rush.

> "These numbers are seeded for the demo, they're not your real franchisees yet. Real ones come during onboarding in M2. But the maths and the layout are all live."

---

### Step 3. The Attention Needed panel

**Chris does:** Points at (or moves the cursor to) the Attention Needed panel on the dashboard. Doesn't click yet.

**Jenni sees:** A short list of items that need her input today. Things like "3 overdue fees", "2 quiet territories", "4 new interest forms".

**Chris says:**
> "This is the bit I'm most pleased with. Instead of scrolling through everything, the system tells you what needs you today. Anything overdue, anything quiet, any new enquiries. Click any one of these and it takes you straight to the page that fixes it."

**Chris does:** Clicks the "new interest forms" line. Lands on `/hq/interest-forms` filtered to status = new.

**Chris says:**
> "Four new enquiries. Postcode, who they are, how many people, what they want. You decide whether to assign a freelancer or use it as a recruitment lead, and you log it here. Nothing falls into a black hole."

---

### Step 4. Franchisee list and detail

**Chris does:** Clicks "Franchisees" in the top nav. Lands on `/hq/franchisees`.

**Jenni sees:** A table of franchisees. Number, name, email, territory count, status, Stripe status (which says "Not connected" everywhere because Stripe is a Phase 2 piece).

**Chris says:**
> "Every franchisee in one list. Searchable, sortable. Click a column header to sort by it, type in the search box to filter."

**Chris does:** Types "Sarah" in the search. The table filters to one row. Clicks the row.

**Jenni sees:** Sarah's profile page at `/hq/franchisees/{id}`. Contact details, the territories she covers, every course she's run, every booking she's taken, an activity timeline.

**Chris says:**
> "Sarah in Clapham. Everything she does, in one place. The territories she covers, every course she's scheduled, every booking she's taken, everything anyone's changed about her record. If she rings you about a missing payment, you don't have to dig through three systems. You're already on the page that has the answer."

If Jenni asks why the seed values say what they say, just answer "These are made-up names for the demo, real franchisees will replace them in M2."

---

### Step 5. Territory map

**Chris does:** Clicks "Territories" in the top nav. Lands on `/hq/territories`.

**Jenni sees:** A split view. On the left, a sortable table of territories. On the right, a Google Map of the UK with coloured markers: green for active, amber for quiet, red for vacant.

**Chris says:**
> "Your whole network on a map. Green means there's an active franchisee taking bookings. Amber means it's quiet, the franchisee is there but the territory's not pulling its weight. Red means no one is covering it."

**Chris does:** Clicks one of the red markers.

**Jenni sees:** An info window pops up with the territory name, status, and a button to assign a franchisee.

**Chris says:**
> "Click an empty territory and you can assign someone to it from here. No separate form, no email to remember. Same thing for amber territories if someone needs a nudge."

---

### Step 6. Bookings list

**Chris does:** Clicks "Bookings" in the top nav. Lands on `/hq/bookings`.

**Jenni sees:** A long table of every booking across the network. Reference number (DA-2026-…), customer name, course, franchisee, payment status (paid / pending / manual), booking status (confirmed / attended / cancelled).

**Chris says:**
> "Every booking the network has ever taken. You filter by date range, by payment status, by franchisee. Looking for one parent in particular?"

**Chris does:** Types a customer name in the search. Filters. Clicks one of the matching rows.

**Jenni sees:** The booking detail page with customer info, payment info, and an audit timeline.

**Chris says:**
> "Two clicks from a customer name to their full booking. The audit timeline at the bottom shows everything that's happened: when they paid, when the franchisee marked them as attended, anything HQ changed."

---

### Step 7. Billing preview

**Chris does:** Clicks "Billing" in the top nav. Lands on `/hq/billing`.

**Jenni sees:** A list of past billing runs (one seeded sample from "last month") and a "Preview next run" button.

**Chris says:**
> "End-of-month fee calculation. The page lists every billing run that's already been raised, and if you want to see what next month looks like, you preview it here."

**Chris does:** Clicks "Preview next run", picks a franchisee with two territories from the dropdown, picks the current month, clicks Preview.

**Jenni sees:** A breakdown by territory, base fee versus 10% of revenue, and the higher of the two charged. A total at the bottom.

**Chris says:**
> "Per territory, the system works out the base fee, £100 or £120 depending on her agreement, and 10% of her revenue, and charges whichever is higher. You can see exactly how it got to the number. If she ever queries it, you've got the working in front of you."

> "From M2's automatic billing piece in Phase 2, this same calculation runs by itself on each franchisee's billing date and pulls the money via direct debit. For now it's preview-only so you can see the maths."

---

### Step 8. Accountant export

**Chris does:** Stays on the billing page. Clicks "Export CSV" (or "Export PDF" depending on what Jenni's accountant prefers).

**Jenni sees:** A file downloads. Chris opens it in Numbers or Excel.

**Chris says:**
> "One row per booking. Franchisee, course, customer, total, payment status, period. Send it to your accountant. CSV for the spreadsheet, PDF for the PDF, your choice."

If she wants to see it in a real spreadsheet, open the CSV in Numbers and scroll through a few rows. Don't dwell.

---

### Step 9. Activity log

**Chris does:** Clicks "Activity" in the top nav. Lands on `/hq/activity`.

**Jenni sees:** A reverse-chronological log of every action anyone has taken in the system. Who, what, when, on which record.

**Chris says:**
> "Every change anyone makes, HQ or franchisee, is logged. Edited a course, assigned a territory, updated a fee tier. It's all here. If you ever need to know who did what and when, this is the page."

> "It's free, in the sense that we don't have to maintain it. Every page that lets you change something writes a row here automatically."

---

## The sign-off ask

**Chris says, slowly:**

> "That's everything in M1. Nine clicks, the whole HQ side. So I want to ask you one question: are we ready to start the franchisee portal next week, or is there anything in here you want changed first?"

Then stop talking. Don't fill the silence. Let her think.

If she says yes: thank her, confirm the M2 invoice will follow once the franchisee portal goes live (about four weeks), and walk her through the handover one-pager (`docs/M1-handover.md`).

If she says she wants changes: write them down. Don't argue. Anything small (copy, layout) gets fixed this week. Anything bigger is a Wave-by-Wave call, depending on whether it blocks M2 or can ship inside M2.

---

## Anticipated questions and answers

These are questions Jenni is most likely to ask. Pre-canned answers below so you don't have to think on the spot.

**"When does this go live for parents?"**

> "M3, weeks 10 to 13. That's when the public booking widget goes on the website, payments turn on for real, and Kartra and BookWhen get switched off. M1 and M2 are setting up everything behind it so M3 has a smooth landing."

**"Can my franchisees see this yet?"**

> "Not yet. M2 starts next week and that's the four-week sprint that builds the franchisee portal, the version Sarah, Maria, Ashley would log into. Until then this is HQ-only."

**"Why does Sarah's name show up as [seed value]? She's not really called that."**

> "That's seed data, made-up franchisees so I can test the system end-to-end. None of these are your real franchisees yet. They get added during M2 onboarding once you've picked the five you want to beta-test the portal first."

**"Can I change [some specific thing, a label, a colour, a column in the table]?"**

If it's a tiny copy or layout change, say yes, write it down, fix it this week, no extra cost.

If it's a feature change (a new column, a new filter, a new screen), say:

> "I can do that. Whether it lands in M2 or M3 depends on what it is. Let me note it down and I'll send you a quick email tomorrow with the answer and where it slots in."

**"What if Stripe isn't ready in time?"**

> "Stripe Connect needs your platform setup to be progressing in the background. There's a separate doc, `docs/stripe-connect-setup.md`, that covers what you and I both need to do. Right now we're in test mode and that's fine for M1 and M2. Live cutover happens at M3 alongside the public booking go-live. As long as the platform setup is filed by the start of M2, we're on track."

**"How do I know nothing's broken?"**

> "Two answers. One, the activity log, which records every change anyone makes. Two, every screen has clear loading and error states, so if something does break you'll see what happened, not a blank page. And there's a CI pipeline that runs every time I push code, so anything I broke gets caught before it reaches you."

**"What if you get hit by a bus?"**

> "Everything is in your accounts. Code is in a GitHub repo on your domain. Database is on a Supabase project that gets transferred to your account at the end. Any developer can pick this up and continue, the architecture is standard and there's a handover guide that comes with the M3 sign-off."

**"What's next, after M1?"**

Walk her through the M1-handover one-pager. M2 in weeks 6–9, M3 in weeks 10–13, Phase 2 fee automation in weeks 14–17. Each one ends with an invoice trigger.

---

## After the call

- Email Jenni the Loom link (`docs/M1-loom-outline.md` is the script for it) and the handover one-pager (`docs/M1-handover.md`).
- If she signed off verbally on the call, follow up with a short email asking for written sign-off so the M1 invoice can be raised.
- Note any change requests in the build plan as Wave 5 punch-list items, or push them into the M2 backlog.
- If she asked for a list of beta franchisees, give her a deadline (e.g. end of next week) and follow up if she hasn't replied by then. M2 onboarding can't start without it.
