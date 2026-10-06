// ---------------------------------------------------------------------------
// CourseDeclarationsCard — medical form submissions for one class
//
// Lucy, Sep 2026: who filled in the form, photo consent, and the non-sensitive
// "please speak to attendee" flag. Migration 065: the certificate email for
// old-form attendees who ticked "Email me about my certificate".
//
// B7 (migration 067, October 2026): attendees on the new form are told their
// email goes to their trainer for the certificate and anything from the class.
// For those rows only, the card shows the email, their "future classes" choice
// and a "Copy emails" button. Old-form rows are shown exactly as before.
// ---------------------------------------------------------------------------

import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { useCourseDeclarations } from './courseDetailQueries';
import { certificateEmailList } from './certificateEmails';
import {
  attendeeClassEmail,
  classEmailList,
  futureClassEmailList,
  isNewFormDeclaration,
  oldFormRows,
} from './attendeeContacts';

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function CourseDeclarationsCard({ courseInstanceId }: { courseInstanceId: string }) {
  const { data: declarations = [], isLoading } = useCourseDeclarations(courseInstanceId);
  // Always render once loaded. Hiding the card while empty meant the guide
  // described a card franchisees could not find (Julie, TRI-0017 follow-up).
  if (isLoading) return null;
  // Migration 065: only old-form attendees who ticked "Email me about my certificate".
  const oldRows = oldFormRows(declarations);
  const certificateEmails = certificateEmailList(oldRows);
  // B7: new-form attendees who gave an email, and those happy to hear about future classes.
  const classEmails = classEmailList(declarations);
  const futureEmails = futureClassEmailList(declarations);
  // Explain each kind of row that is on the card. An empty card explains the
  // current form, since any new declaration will be a new-form one.
  const showNewFormNote = oldRows.length < declarations.length || declarations.length === 0;
  const showCertificateNote = oldRows.length > 0;
  const copyText = (text: string, done: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(done))
      .catch(() => toast.error('Could not copy, sorry'));
  };
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint border-b px-5 py-4">
        <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
          Medical declarations ({declarations.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 p-5">
        {declarations.length === 0 ? (
          <p className="text-daisy-muted text-sm">
            No one has filled in the medical form for this class yet. Names and badges appear here
            as attendees submit it, by scanning your QR code or typing your instructor number at the
            medical form address.
          </p>
        ) : null}
        {declarations.map((d) => {
          const newForm = isNewFormDeclaration(d);
          const email = attendeeClassEmail(d);
          return (
            <div key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-daisy-ink font-semibold">{d.attendee_name}</span>
              {d.photo_consent === true ? (
                <Badge variant="success" className="text-[11px]">
                  photos OK
                </Badge>
              ) : d.photo_consent === false ? (
                <Badge variant="danger" className="text-[11px]">
                  no photos
                </Badge>
              ) : null}
              {d.medical_flagged === true ? (
                <Badge variant="danger" className="text-[11px]">
                  please speak to attendee
                </Badge>
              ) : d.medical_flagged === false ? (
                <Badge variant="default" className="text-[11px]">
                  nothing flagged
                </Badge>
              ) : null}
              {newForm && email ? (
                <span className="text-daisy-muted flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="flex items-center gap-1">
                    Email:
                    <button
                      type="button"
                      title="Click to copy"
                      onClick={() => copyText(email, `Copied ${email}`)}
                      className="hover:text-daisy-primary break-all underline-offset-2 hover:underline"
                    >
                      {email}
                    </button>
                  </span>
                  {d.trainer_contact_opt_in ? (
                    <Badge variant="success" className="text-[11px]">
                      future classes: yes
                    </Badge>
                  ) : (
                    <Badge variant="default" className="text-[11px]">
                      future classes: no
                    </Badge>
                  )}
                </span>
              ) : null}
              {newForm && !email ? (
                <span className="text-daisy-muted w-full text-xs">No email given</span>
              ) : null}
              {!newForm && d.certificate_email ? (
                <span className="text-daisy-muted flex w-full items-center gap-1 text-xs">
                  Certificate email:
                  <button
                    type="button"
                    title="Click to copy"
                    onClick={() => copyText(d.certificate_email!, `Copied ${d.certificate_email}`)}
                    className="hover:text-daisy-primary break-all underline-offset-2 hover:underline"
                  >
                    {d.certificate_email}
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
        {classEmails.length > 0 ? (
          <div className="border-daisy-line-soft mt-2 flex flex-col gap-2 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  copyText(classEmails.join(', '), `Copied ${plural(classEmails.length, 'email')}`)
                }
              >
                Copy emails ({classEmails.length})
              </Button>
              <span className="text-daisy-muted text-xs">
                For the certificate and anything from this class. Paste into BCC.
              </span>
            </div>
            {futureEmails.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copyText(
                      futureEmails.join(', '),
                      `Copied ${plural(futureEmails.length, 'email')} (future classes: yes)`,
                    )
                  }
                >
                  Copy future-class emails ({futureEmails.length})
                </Button>
                <span className="text-daisy-muted text-xs">
                  Only people who said yes to hearing about future classes and a review request.
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
        {certificateEmails.length > 0 ? (
          <div className="border-daisy-line-soft mt-2 flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                copyText(
                  certificateEmails.join(', '),
                  `Copied ${certificateEmails.length} certificate email${certificateEmails.length === 1 ? '' : 's'}`,
                )
              }
            >
              Copy certificate emails ({certificateEmails.length})
            </Button>
            <span className="text-daisy-muted text-xs">
              For certificate information about this class only. Paste into BCC.
            </span>
          </div>
        ) : null}
        <p className="text-daisy-muted mt-2 text-xs">
          "Please speak to attendee" means they flagged a condition or requirement on the medical
          form. The detail itself is encrypted and only HQ can unlock it — ask the attendee directly
          at the start of class. If a freelancer is delivering this class, brief them from this card
          the day before: who to have a quiet word with and who has said no photos. They do not need
          portal access.
        </p>
        {showNewFormNote ? (
          <p className="text-daisy-muted text-xs">
            An email shows for attendees who gave one on the medical form, which told them you will
            use it to send their certificate and anything from the class. Only email someone about
            future classes or ask them for a review if their badge says "future classes: yes".
          </p>
        ) : null}
        {showCertificateNote ? (
          <p className="text-daisy-muted text-xs">
            A certificate email shows only for attendees who ticked "Email me about my certificate"
            on the form. Use it to send certificate information for this class and nothing else: it
            is not a mailing list.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
