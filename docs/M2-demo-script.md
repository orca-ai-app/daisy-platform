# M2 Demo Script

**For:** Jenni Dunman (+ Ashley Carter if attending)
**Length:** about 25 minutes
**Format:** live walk-through, Chris driving, Jenni watching, questions welcome at any point

This is the script for the live call. Keep it open on a second monitor and follow along. Each step has the URL to navigate to, what the screen should look like, and what to say. It is not a script to read word for word.

The aim is simple: show Jenni that Ashley now has his own working portal, that the franchisee experience is genuinely separate from HQ, and that every action he takes is logged. By the end she should have answered: "will my franchisees actually use this, and what happens next?"

---

## Pre-flight checklist (run 30 minutes before the call)

Tick each one before joining. If any fails, fix it before Jenni dials in.

- [ ] Sign in as `ashley.carter@daisyfirstaid.com` via the dev role-switch (or a real test auth account). Confirm you land on `/franchisee/dashboard`, not a 404 or blank screen.
- [ ] Confirm the four KPI cards on the franchisee dashboard show sensible numbers. Revenue MTD should be non-zero (seed has five May 2026 bookings totalling £380).
- [ ] Navigate to `/franchisee/courses`. Confirm five course instances appear: three public (June and July), two private (Bright Futures Nursery, Clapham Primary School). Check at least one appears in the calendar view.
- [ ] Navigate to `/franchisee/clients`. Confirm three private clients appear: Bright Futures Nursery, Clapham Primary School, Westminster Childminders Network.
- [ ] Navigate to `/franchisee/discounts`. Confirm two codes appear: ASHLEY10 (10%, active) and SWFIXED15 (£15 fixed, active).
- [ ] Try navigating to `/hq/dashboard` while still in the Ashley role. Confirm you land on `/unauthorized`.
- [ ] Confirm Netlify is deploying the current `m2/wave-9` HEAD.
- [ ] Close every other browser tab and notification source. Mute Slack, mute email.
- [ ] Camera and audio tested.

---

## The walk-through (12 steps)

### Step 1. The login screen

**Chris does:** Opens a fresh browser tab, navigates to the portal URL. Does not sign in yet.

**Jenni sees:** The same Daisy-branded login screen she saw in M1. Nothing different from the outside.

**Chris says:**

> "Same front door for everyone. Jenni logs in and gets HQ. Ashley logs in and gets his own portal. The system works out who he is. He doesn't need a separate URL, a separate login, a separate app."

---

### Step 2. Franchisee dashboard

**Chris does:** Signs in as Ashley. Lands on `/franchisee/dashboard`.

**Jenni sees:** Four KPI cards: upcoming courses, bookings this month, revenue this month, outstanding capacity. Below them: a recent bookings panel and an upcoming courses panel.

**Chris says:**

> "This is what Ashley sees on Monday morning. His numbers, not the network's. Revenue this month, how many courses he has coming up, how many seats are still unfilled. The recent bookings panel shows the last five, and the upcoming panel shows the next seven days."

Let her read the numbers. Don't rush.

> "These come from real data in the database. He has five bookings in May and five courses scheduled. The platform is already doing the maths for him."

---

### Step 3. Role guard

**Chris does:** While still signed in as Ashley, manually types `/hq/dashboard` into the address bar. Press Enter.

**Jenni sees:** `/unauthorized` page.

**Chris says:**

> "Ashley can't see Jenni's dashboard. He can't see another franchisee's bookings. He can't see the billing screen. The database itself enforces this, not just a redirect. Even if he crafted a raw API request, the data would come back empty."

---

### Step 4. My territories

**Chris does:** Clicks "Territories" in the top nav. Lands on `/franchisee/territories`.

**Jenni sees:** A table of Ashley's postcode areas (SW1A Westminster, SW4 Clapham) with course count and revenue for the month. A map sidecar with markers. Click a row to highlight it on the map.

**Chris says:**

> "Read-only for Ashley. He can see what territories he's responsible for, how many courses he's run in each one this month, and how much revenue each one has generated. If he wants to request a new territory, there's a button that drafts an email to you."

---

### Step 5. Courses list

**Chris does:** Clicks "Courses" in the top nav. Lands on `/franchisee/courses`.

**Jenni sees:** A list of five course instances. Three are marked Public, two Private. Dates run from mid-June to mid-July. Status is Scheduled on all five.

**Chris says:**

> "Ashley's schedule. Status filter, date range filter, and a calendar toggle. The calendar shows the same data laid out by month."

**Chris does:** Clicks the calendar toggle.

**Jenni sees:** A month grid. The June courses appear as chips on the right dates.

**Chris says:**

> "Calendar view. Click any chip and you go straight to that course."

---

### Step 6. Create a public course (live)

**Chris does:** Clicks "Schedule a course". Goes through the five-step wizard:

- Step 1: picks "Baby and Child First Aid (Full Day)".
- Step 2: date about four weeks out, a Westminster postcode, venue name "Daisy Studio SW1A", start/end time.
- Step 3: leave default pricing. Default Single ticket type stays.
- Step 4: visibility Public.
- Step 5: review and save.

**Jenni sees:** Each step on screen, then a success toast, then the detail page for the new course.

**Chris says:**

> "Five steps. Pick a template, set the date and venue, confirm the price, choose public or private, review and save. The platform geocodes the postcode, checks whether it is in Ashley's territory, and flags a warning if not. Ticket types default to Single, and he can add Couple or Family from the detail page."

---

### Step 7. Out-of-territory warning

**Chris does:** Clicks "Schedule a course" again. In Step 2, type a postcode from another franchisee's territory (e.g. NW1 from Sarah's Camden area).

**Jenni sees:** A red warning banner: this postcode is covered by another franchisee. A confirmation tick appears.

**Chris says:**

> "Red means someone else has that territory. Ashley has to actively tick the box to override. The override is stamped on the record, activity-logged, and visible to you in HQ. He can still run the course, but you will always know it happened."

**Chris does:** Cancels back out. No need to save this one.

---

### Step 8. Course detail, ticket types, and cancel

**Chris does:** Navigates to one of the existing scheduled courses. Shows the detail page.

**Jenni sees:** Course info, venue, capacity, a ticket types panel with one "Single" row, an activity timeline.

**Chris does:** Clicks "Add ticket type". Adds a Couple ticket at £185. Saves. The new row appears.

**Chris says:**

> "He can add any ticket variants he wants. Single, Couple, Family, Group. Each one has a price, a seat count, and an optional cap. The system tracks how many seats are sold against capacity."

**Chris does:** Points at "Cancel course" button but does not click it.

**Chris says:**

> "Cancel is here when he needs it. He gives a reason, it is logged, the course is marked cancelled. Bookings on that course are preserved but the course is taken off his live schedule."

---

### Step 9. Private course and private client

**Chris does:** Navigates to one of the two private course instances (Bright Futures Nursery).

**Jenni sees:** The course detail shows `visibility: private` and the linked client "Bright Futures Nursery".

**Chris says:**

> "Private courses are for schools, nurseries, corporates. Not visible in the public booking widget. Ashley books them by generating a link he sends directly to the client."

**Chris does:** Clicks "Clients" in the top nav.

**Jenni sees:** Three private clients listed: Bright Futures Nursery, Clapham Primary School, Westminster Childminders Network. Contact name, email, phone, notes.

**Chris says:**

> "His client directory. Every school or company he runs private courses for. When he creates a new private course, he picks the client from a dropdown and the system links them. The recent-bookings panel on each client shows the history."

---

### Step 10. Payments and Stripe Connect (PARKED - after Stripe connect)

> **Note for demo:** Wave 8 (Stripe Connect and Payment Links) is parked awaiting Stripe test-mode credentials. The Payments tab is visible in the nav but shows a "coming soon" state until credentials are provided. Do not demo this step live. Explain it verbally only.

**Chris says:**

> "One tab you can see but we haven't clicked yet: Payments. That's where Ashley connects his Stripe account. Once he does, he can generate a payment link for any private course, send it to the client, and Stripe routes the money directly to Ashley's bank account. Daisy HQ takes a two percent platform fee automatically. That part is ready to turn on the moment we have the Stripe test-mode credentials from you. I'll send you the setup doc after this call."

---

### Step 11. Discount codes

**Chris does:** Clicks "Discounts" in the top nav. Lands on `/franchisee/discounts`.

**Jenni sees:** Two codes: ASHLEY10 (10%, 3 uses, active) and SWFIXED15 (£15 fixed, 1 use, active).

**Chris says:**

> "Ashley creates his own discount codes. Percentage off or fixed amount. He can set a usage cap and an expiry date. When the public booking widget launches in M3 these get validated at checkout. For now, they are stored ready."

**Chris does:** Clicks "Create code". Shows the dialog, fills in a test code, then cancels without saving.

---

### Step 12. Profile

**Chris does:** Clicks the avatar in the top right, then "Profile" or navigates to `/franchisee/profile`.

**Jenni sees:** His name and phone are editable. Email is greyed out with a lock icon. Below, account summary: franchisee number, status, fee tier, billing date.

**Chris says:**

> "Ashley can update his own name and phone number. His email and fee tier are yours to control. He can see them, he cannot change them. Same data you set from the HQ franchisee page."

---

## The sign-off ask

**Chris says, slowly:**

> "That is M2. Ashley has his own portal, his own data, his own schedule. He can run his business through here without touching a spreadsheet. The one thing that's not live yet is Stripe payments, and that is waiting on the test credentials, not on any build work. Everything else is production-quality. So the question is: are we ready to talk about M3 - the public booking widget and medical declarations - or is there anything in here you want changed first?"

Then stop. Let her think.

If she says yes: walk her through the M2-handover one-pager. Confirm the M2 invoice follows her written sign-off.

If she wants changes: write them down. Small copy or layout changes this week. Anything bigger gets scoped and slotted.

---

## Anticipated questions and answers

**"When does Stripe go live for Ashley?"**

> "The moment you file the two credentials in the Stripe setup doc. Both are test-mode keys - no real money, no KYC, just a ten-minute task. I will send you the exact steps after this call. Once those are in, Wave 8 takes about a week to wire up."

**"Can my other franchisees log in now?"**

> "Technically yes, if we create their auth accounts. Practically, Ashley is the first because we wanted one person to sign off the experience before rolling it to everyone. If this demo looks right to you, we can start provisioning the others whenever you're ready."

**"Why is the Bookings tab not in the nav?"**

> "The bookings list for franchisees is Wave 9A, which ships alongside Stripe, because the interesting bookings come from Stripe payments. Ashley can see his bookings on the dashboard today and from the HQ side you can see all of them. The full franchisee bookings list lands when Stripe is connected."

**"Can Ashley see Jenni's revenue?"**

> "No. Open the network tab in dev tools and watch the query. The database returns only his rows. There is no client-side filter you could trick. Row-level security in the database is the only guard."

**"What's next after M2?"**

> "M3 is the public booking widget, parents can find courses on your website and book directly, real Stripe payments, QR medical declarations, and email notifications. BookWhen and Kartra get switched off the day M3 goes live. That's weeks ten to thirteen."

---

## After the call

- Email Jenni the `docs/M2-handover.md` one-pager and the Stripe setup doc link.
- If she signed off verbally, follow up with a short email asking for written sign-off so the M2 invoice can be raised.
- Note any change requests as punch-list items.
- Send Stripe setup doc (`docs/stripe-connect-setup.md`) with the specific credentials needed highlighted.
