/**
 * Help article content for the franchisee portal.
 *
 * All copy is UK English, plain friendly tone, no em dashes (commas instead),
 * no emojis. Button/label text matches the actual UI exactly.
 */

export interface HelpSection {
  heading?: string;
  body?: string[];
  steps?: string[];
}

export interface HelpArticle {
  slug: string;
  title: string;
  summary: string;
  keywords: string[];
  sections: HelpSection[];
  related?: string[];
  videoUrl?: string;
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    summary: 'How to log in, what each section of the portal is for, and where to go for help.',
    keywords: ['login', 'sign in', 'invite', 'navigation', 'overview', 'dashboard', 'portal'],
    sections: [
      {
        heading: 'Logging in',
        body: [
          'You log in at /login using the email address in your invite email. The invite link lets you set your password on first use. If you did not receive an invite, or the link has expired, contact HQ and they will send a fresh one.',
          'Once you are in, you stay logged in unless you actively sign out.',
        ],
      },
      {
        heading: 'What each section is for',
        body: [
          'Dashboard: a summary of upcoming courses, recent bookings, and anything that needs your attention.',
          'Territories: the postcodes that make up your franchise area, shown on a map.',
          'Courses: your scheduled, completed, and cancelled course instances. This is where you add new classes and manage existing ones.',
          'Bookings: every booking made for your courses, with filters, search, and the ability to add offline bookings.',
          'Customers: people who have booked with you, plus anyone who has submitted a medical form for your classes.',
          'Clients: private clients (companies and groups) you run tailored courses for.',
          'Discounts: promotional codes you create for customers to use at checkout.',
          'Payments: your Stripe connection. All card payments from customers are handled here.',
          'Profile: your personal details and your permanent medical form QR code.',
          'Help: these guides.',
        ],
      },
      {
        heading: 'Where to get help',
        body: [
          'Check the guides in this section first. If you cannot find the answer, contact HQ directly.',
        ],
      },
    ],
    related: ['connecting-stripe', 'managing-courses', 'getting-help'],
  },

  {
    slug: 'connecting-stripe',
    title: 'Connecting your Stripe account',
    summary:
      'Why you need Stripe, how to connect it, and what happens to payments once it is set up.',
    keywords: [
      'stripe',
      'payments',
      'connect',
      'bank',
      'card',
      'payout',
      'online payments',
      'connect with stripe',
    ],
    sections: [
      {
        heading: 'Why you need to connect Stripe',
        body: [
          'Card payments from customers go directly into your own bank account via Stripe. Without a connected Stripe account, customers cannot pay online for your courses. You must complete this before the switchover from BookWhen.',
          'Daisy takes a 2% platform fee. All other revenue settles directly to your bank on Stripe\'s normal payout schedule, which is usually within a few working days.',
        ],
      },
      {
        heading: 'How to connect',
        steps: [
          'Go to the Payments section in the left-hand navigation.',
          'Click "Connect with Stripe".',
          'You will be taken to Stripe\'s website. Sign in to your existing Stripe account, or follow the steps to create one if you do not have one yet.',
          'Once you authorise the connection, Stripe sends you back to the portal. The Payments page will show "Connected" with your masked account ID.',
        ],
      },
      {
        heading: 'What customers see',
        body: [
          'Customers pay by card on the booking page. They see a standard Stripe payment form. The charge appears on their statement under your Stripe account name.',
        ],
      },
      {
        heading: 'How payouts work',
        body: [
          'Stripe pays out to your linked bank account on its normal schedule, usually a few working days after each transaction. You can see full payout details in your Stripe dashboard, which you can open directly from the Payments page in the portal.',
        ],
      },
    ],
    related: ['getting-started', 'moving-from-bookwhen'],
  },

  {
    slug: 'managing-courses',
    title: 'Adding and managing your classes',
    summary:
      'How to add a new course, edit it, cancel it, and manage ticket types and capacity.',
    keywords: [
      'course',
      'class',
      'schedule',
      'new course',
      'schedule a course',
      'ticket',
      'capacity',
      'spaces',
      'visibility',
      'public',
      'private',
      'cancel',
      'edit',
    ],
    sections: [
      {
        heading: 'Adding a new class',
        body: [
          'Go to Courses and click "Schedule a course". A wizard walks you through five steps.',
        ],
        steps: [
          'Template: pick the course type from the list provided by HQ.',
          'Venue and date: enter the event date, start and end times, venue name, address, and postcode. The system checks whether the postcode is within your territory and warns you if it is not.',
          'Pricing and capacity: set the price and maximum number of spaces. You can also add ticket types here (for example, Individual, Couple, or Family).',
          'Visibility: choose Public (appears on the Daisy website) or Private (direct link only, for clients and private groups). Private courses require a description.',
          'Review: check all the details, then save. You are taken straight to the course page.',
        ],
      },
      {
        heading: 'Editing a course',
        body: [
          'Open the course from the Courses list and click "Edit course" at the top right. You can change the date, time, venue, capacity, and visibility. You cannot edit a cancelled course.',
        ],
      },
      {
        heading: 'Cancelling a course',
        body: [
          'Open the course and click "Cancel course". You will be asked for a reason. Existing bookings are kept in the system and their customers can still be seen in Bookings. Refunds, where owed, need to be processed in your Stripe dashboard.',
        ],
      },
      {
        heading: 'Ticket types',
        body: [
          'A ticket type is a named category with a price and a number of seats it consumes. For example, a Couple ticket might consume 2 spaces while a Single ticket consumes 1.',
          'On a course page, scroll to the ticket types section. Click "Add ticket type" to create one. You can also edit or delete existing ticket types using the pencil and bin icons on each row.',
          '"Spaces" means the number of places left on the course based on capacity minus the seats consumed by confirmed bookings. When spaces reach zero, the course shows as full.',
        ],
      },
    ],
    related: ['booking-links', 'bookings'],
  },

  {
    slug: 'booking-links',
    title: 'Sharing your booking link',
    summary:
      'Every class has its own booking link. Here is how to find it, share it, and what customers see.',
    keywords: [
      'booking link',
      'share',
      'whatsapp',
      'copy link',
      'public',
      'website',
      'postcode search',
      'book online',
    ],
    sections: [
      {
        heading: 'Finding the booking link for a class',
        body: [
          'Open the class from the Courses list. On the course detail page, find the Booking link card. It shows the full URL for that class.',
          'Click "Copy link" to copy it to your clipboard, or click "Send via WhatsApp" to open WhatsApp with the link pre-filled in a message.',
        ],
      },
      {
        heading: 'What customers see when they follow the link',
        body: [
          'The link opens the Daisy booking page for that specific class. Customers see the course name, date, time, and venue, and can choose a ticket type. They fill in their details and pay by card through Stripe.',
          'After paying, they receive a confirmation email from the system.',
        ],
      },
      {
        heading: 'Public classes and the website',
        body: [
          'If you set a class to Public when creating it, it appears automatically on the Daisy website. Visitors can search by postcode and find it. You do not need to do anything extra.',
          'Private classes do not appear in the postcode search. Share the booking link directly with the group or client.',
        ],
      },
    ],
    related: ['managing-courses', 'bookings'],
  },

  {
    slug: 'bookings',
    title: 'Managing bookings',
    summary:
      'How to view and filter bookings, add an offline booking, mark it as paid, add notes, and cancel.',
    keywords: [
      'booking',
      'add booking',
      'mark as paid',
      'add note',
      'cancel booking',
      'cheque',
      'invoice',
      'offline',
      'phone',
      'pending',
    ],
    sections: [
      {
        heading: 'The bookings list',
        body: [
          'Go to Bookings. The list shows all bookings for your courses with the customer name, course, ticket type, total, payment status, and booking status.',
          'Use the search box to find a specific booking by reference. Use the drop-down filters to narrow by payment status, booking status, or date range.',
          'Click any row to open the full booking detail.',
        ],
      },
      {
        heading: 'Adding an offline booking',
        body: [
          'Use "Add booking" when someone books by phone, pays by cheque, or you need to invoice them. The booking is created with a payment status of "pending" so you can mark it paid once money arrives.',
        ],
        steps: [
          'Click "Add booking" at the top right of the Bookings page.',
          'Choose the class from the list.',
          'Choose the ticket type.',
          'Enter the quantity.',
          'Fill in the customer\'s name, email, and phone number.',
          'Save. The booking is created and you are taken to its detail page.',
        ],
      },
      {
        heading: 'Marking a booking as paid',
        body: [
          'Open the booking and click "Mark as paid". A small form asks for a payment reference, for example a cheque number or invoice ID. Enter the reference and confirm. The payment status updates to "manual" and the action is logged in the activity timeline.',
          'This button is only available when the booking\'s payment status is "pending".',
        ],
      },
      {
        heading: 'Adding a note',
        body: [
          'Open the booking and click "Add note". Notes are append-only, each timestamped with the date and time it was added. They are useful for recording things like special requirements or follow-up actions.',
        ],
      },
      {
        heading: 'Cancelling a booking',
        body: [
          'Open the booking and click "Cancel booking". You will be asked for a cancellation reason. Optionally enter a refund amount as a record-only flag. The actual refund, where owed, needs to be processed in your Stripe dashboard.',
        ],
      },
      {
        heading: 'Carrying over BookWhen attendees',
        body: [
          'If you have existing attendees from BookWhen, add them as offline bookings and mark them as paid. This keeps your spaces count accurate on the new system. See the guide "Moving from BookWhen" for the full process.',
        ],
      },
    ],
    related: ['managing-courses', 'moving-from-bookwhen'],
  },

  {
    slug: 'medical-qr',
    title: 'Your medical form QR code',
    summary:
      'You have one QR code, the same one for every class you run. Print it once and display it at every session.',
    keywords: [
      'qr',
      'qr code',
      'medical',
      'medical form',
      'health',
      'declaration',
      'instructor number',
      'print',
      'laminate',
    ],
    sections: [
      {
        heading: 'One QR, forever',
        body: [
          'You have a single, permanent QR code. It never changes. Find it on your Profile page, where it is always visible. It also appears on every course detail page.',
          'Print it or laminate it once. There is no need to reprint for each class, and no risk of a laminated QR becoming outdated.',
        ],
      },
      {
        heading: 'How it works',
        body: [
          'When an attendee scans the QR at your class, the medical form opens and automatically finds which of your classes is running that day. If you run two classes on the same day, the attendee sees a short list and picks the right one.',
          'Attendees who do not have a camera can type your instructor number directly at medical.daisyfirstaid.com instead.',
        ],
      },
      {
        heading: 'The "who made the booking?" question',
        body: [
          'The medical form asks whether the attendee booked in advance or is a walk-in. This links each submission to the right booking record so you can match attendees to bookings later.',
        ],
      },
      {
        heading: 'What you can see',
        body: [
          'In the Customers section, the All contacts tab shows everyone who has submitted a medical form for your classes. You can see their name, the email they gave, and whether they opted in to marketing.',
          'Health answers are kept confidential. They are encrypted and only HQ can unlock them for clinical or safeguarding reasons. Every unlock is logged automatically.',
        ],
      },
    ],
    related: ['customers-contacts', 'getting-started'],
  },

  {
    slug: 'customers-contacts',
    title: 'Customers and contacts',
    summary:
      'How to view people who have booked with you, and those who have submitted medical forms.',
    keywords: [
      'customers',
      'contacts',
      'booked customers',
      'all contacts',
      'medical form',
      'email',
      'history',
      'follow-up',
      'opt-in',
    ],
    sections: [
      {
        heading: 'The Customers page',
        body: [
          'Go to Customers in the navigation. The page has two views toggled by the buttons at the top.',
        ],
      },
      {
        heading: 'Booked customers',
        body: [
          'The "Booked customers" view shows everyone who has completed a booking for one of your courses. Each row shows name, email, phone, postcode, and booking count.',
          'Click "History" on any row to expand that customer\'s booking history inline.',
        ],
      },
      {
        heading: 'All contacts',
        body: [
          'The "All contacts" view combines booked customers with people who have submitted a medical form for your classes, deduplicated by email. Contacts who only appear from a medical form are labelled "from medical form".',
          'This gives you a fuller picture of people who have engaged with your sessions, even if they attended as part of a group booking made by someone else.',
        ],
      },
      {
        heading: 'Marketing follow-ups',
        body: [
          'Attendees who opt in during the medical form process automatically receive a follow-up email series from Daisy. You do not need to manage this manually.',
        ],
      },
    ],
    related: ['medical-qr', 'bookings'],
  },

  {
    slug: 'discount-codes',
    title: 'Discount codes',
    summary: 'How to create, edit, and deactivate promotional codes for customers.',
    keywords: [
      'discount',
      'promo',
      'code',
      'percentage',
      'fixed',
      'voucher',
      'create code',
      'checkout',
      'promotion',
    ],
    sections: [
      {
        heading: 'Creating a code',
        body: [
          'Go to Discounts and click "+ Create code". A dialog opens.',
        ],
        steps: [
          'Enter a code. It will be uppercased automatically, for example "SUMMER25".',
          'Choose whether it is a percentage off or a fixed pound amount off.',
          'Enter the value.',
          'Optionally set start and end dates and a maximum number of uses.',
          'Click "Create code" to save.',
        ],
      },
      {
        heading: 'Editing or deactivating a code',
        body: [
          'Click the edit icon on any row in the Discounts list. The same dialog opens with the existing values pre-filled.',
          'To stop a code working without deleting it, untick "Active" and save. Inactive codes are stored but cannot be redeemed at checkout.',
        ],
      },
      {
        heading: 'What customers see',
        body: [
          'On the booking page, customers enter their discount code in the code field before completing payment. The price updates in real time to show the reduced amount. Expired, inactive, or used-up codes are rejected with a clear message.',
        ],
      },
    ],
    related: ['bookings', 'managing-courses'],
  },

  {
    slug: 'moving-from-bookwhen',
    title: 'Moving from BookWhen',
    summary:
      'The four steps to switch over from BookWhen to the new Daisy booking system, and what to do on switchover day.',
    keywords: [
      'bookwhen',
      'migration',
      'switchover',
      'move over',
      'carry over',
      'attendees',
      'existing bookings',
      'cancel subscription',
    ],
    sections: [
      {
        heading: 'The four steps before switchover day',
        steps: [
          'Log in: use the invite email to access your portal. If you cannot log in, contact HQ straight away.',
          'Connect Stripe: go to Payments and click "Connect with Stripe". Card payments from customers cannot reach you until this is done.',
          'Add your upcoming classes: go to Courses and click "Schedule a course" for each class currently listed on BookWhen. Use the same date, time, venue, and price.',
          'Carry over existing bookings: for each person who has already paid through BookWhen, go to Bookings, click "Add booking", choose the class and ticket type, enter their details, save, then open the booking and click "Mark as paid". This keeps your spaces count accurate on the new system.',
        ],
      },
      {
        heading: 'Stop adding to BookWhen',
        body: [
          'From now on, add all new classes only to the new system. Leave existing BookWhen listings live until switchover day so customers can still book through them, but do not create any new events on BookWhen.',
        ],
      },
      {
        heading: 'On switchover day',
        steps: [
          'First thing that morning, switch off your BookWhen booking pages (hide or close the event listings in your BookWhen account).',
          'The Daisy website\'s postcode search will point at the new system from that morning.',
          'Share booking links for your classes from the course detail pages using "Copy link" or "Send via WhatsApp".',
        ],
      },
      {
        heading: 'The week after switchover',
        steps: [
          'Keep your BookWhen account open for one more week in case you need to look anything up, but leave the booking pages switched off.',
          'Download your BookWhen history for your own records using BookWhen\'s export function.',
          'After that week, cancel your BookWhen subscription.',
        ],
      },
    ],
    related: ['connecting-stripe', 'managing-courses', 'bookings'],
  },

  {
    slug: 'getting-help',
    title: 'Getting help',
    summary: 'Check these guides first, then contact HQ if you are still stuck.',
    keywords: [
      'help',
      'support',
      'contact',
      'stuck',
      'problem',
      'issue',
      'log in',
      'stripe',
      'website',
      'hq',
    ],
    sections: [
      {
        heading: 'Check these guides first',
        body: [
          'Most questions are answered in the guides in this Help section. Use the search box at the top to find what you need.',
        ],
      },
      {
        heading: 'Quick answers to common questions',
        body: [
          'Cannot log in: check your spam folder for the invite email. If the link has expired, reply to the announcement email and HQ will send a new one. You can also use the password reset link on the /login page.',
          'Customer cannot pay by card: check that your Stripe account is connected. Go to Payments, the status should show "Connected". If it shows the "Connect with Stripe" button, complete that step first.',
          'My class is not showing on the Daisy website: the class must be set to Public, the date must be in the future, and there must be at least one space remaining. Open the class in Courses and check the visibility and capacity settings.',
        ],
      },
      {
        heading: 'Contacting HQ',
        body: [
          'If the guides do not answer your question, contact HQ directly. Reply to any email from Daisy First Aid, or use the contact details in your franchise agreement. HQ will respond as quickly as possible.',
        ],
      },
    ],
    related: ['getting-started', 'connecting-stripe', 'managing-courses'],
  },
];

/** Look up a single article by slug. Returns undefined if not found. */
export function findArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}
