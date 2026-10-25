# Privacy notice for the Doppelpunkt beta

*Version for the v0.5 closed beta. Last updated: 2026-10-25.*

Doppelpunkt works without sending anything to us. Your progress, your answers and your AI key stay
on your device. During the beta you can choose to help us find bad exercises by sharing three kinds
of data. **All three start switched off**, and you can switch each one on or off at any time in
the beta section of **Settings**.

## The short version

- Nothing is sent unless you switch it on.
- We never collect your name, email address, IP address, your AI key, your progress or your
  written answers (except the one answer you choose to attach to a report).
- Item statistics are counts per exercise. We store them without any id, so they can't be traced
  back to you.
- Switching statistics off deletes your random install id on your device and asks our server to
  delete its record of it.
- Crash reports are deleted after 90 days, reports after one year, the install record 120 days after
  your last upload.

## What you can share

### 1. "This is wrong / unclear" reports

You send these yourself, from the exercise screen. A report contains:

- which exercise and unit it is about, and the app and content version
- the reason you picked (wrong answer, unclear, typo, audio, Swiss form, other)
- your comment, if you write one (up to 500 characters). **Please don't put personal details in it.**
- your answer, only if you tick "include my answer"
- the time you sent it

Reports carry no install id, so we can't link several reports to each other or to you.

### 2. Item statistics

If you switch this on, the app counts, for each exercise you do: how many attempts, how well your
first try went (in three coarse bands), and the time spent (rounded to 5 seconds). It uploads these
counts about once a day together with your coarse level band (for example "A1+"), the app and
content version, the date, and a **random install id**.

- The install id is made on your device when you switch statistics on. It isn't derived from
  anything about you or your device, it is replaced with a new one every 90 days, and it is deleted
  when you switch statistics off.
- On the server we never store the id itself, only a keyed hash of it, together with the week you
  first uploaded, the day of your last upload and which weeks you were active. We use this only to
  count how many learners keep learning after 1, 2, 3 and 4 weeks.
- The exercise counts are added onto totals per exercise, day and first-seen week. They are stored
  **without** the install id or its hash.

### 3. Crash reports

If you switch this on, the app sends a report when it crashes: the error name and message, the
technical stack trace (with file paths shortened to the app's own file names), the screen you were
on (without any query), the browser name and version, the app version and the time. Before
sending, the app removes email addresses, web addresses with parameters and long numbers from the
text. The server removes them again in case something slipped through.

## What we never collect

- your name, email address, phone number or any account details (there are no accounts)
- your IP address (see below), precise location, device identifiers or advertising ids
- your AI key, your conversations with the AI tutor, your recordings or your written answers
  (except the one answer you attach to a report)
- your learning progress, your review schedule or your settings
- cookies or tracking across other sites; there are no third-party trackers in the app

**About IP addresses.** Like every website, our server has to see your IP address to answer the
request. It does not store or log it. To stop abuse, it turns the address and the date into a
short keyed hash that changes every day and is kept for at most one hour, only to count requests.
Request logging is switched off.

## How long we keep it

| Data | Kept for |
| --- | --- |
| Crash reports | 90 days |
| "Wrong / unclear" reports | 1 year |
| Install record (hashed id, first week, last day, active weeks) | until 120 days after your last upload, or until you switch statistics off |
| Exercise totals (no id) | as long as we improve the course; they are anonymous |

Deletion runs automatically once a day.

## Switching off and deleting

- **Statistics off:** the app deletes the install id and the counts it hasn't sent yet, and tells
  the server to delete your install record. If you are offline, it does this the next time you are
  online. Totals you already sent stay, because they can't be linked to you.
- **Crash reports off:** reports that have not been sent yet are deleted from your device.
- **Reports** can't be linked to you by us. If you want one removed, write to us with the exercise
  and the approximate time and we will look for it.
- **Delete everything on your device:** Settings → Your data → Reset everything, or clear the site
  data in your browser.

## Where the data is

The beta server is a Cloudflare Worker with a Cloudflare D1 database. We run it in a European data
location. Cloudflare acts as our processor and may handle network traffic outside Switzerland and
the EU, for example in the United States. Only the beta team can read the data, through a
password-protected export, to find and fix exercises.

## Your rights and contact

You can ask what we hold about you, ask us to correct or delete it, withdraw your consent at any
time (switching off has effect for the future), and complain to a data protection authority
(in Switzerland the FDPIC, in the EU the authority in your country).

Because we don't know who you are, we can usually only find your data with your help. For the
install record you don't need us: switching statistics off makes the app ask the server to delete it.

Contact: **[privacy contact, e.g. privacy@example.org]** · Operator: **[name and address of the
operator]**

---

## Notes for the operator (GDPR and Swiss nFADP)

*Not legal advice. Check with counsel before the public launch (v1.0 "Legal").*

- **Roles.** Whoever deploys `services/collector` is the controller. Cloudflare is a processor;
  accept Cloudflare's Data Processing Addendum in the dashboard.
- **Legal basis.** Consent (GDPR Art. 6(1)(a)); each kind of data is a separate, off-by-default
  switch, and withdrawing is as easy as giving consent. Storing the install id on the device is
  covered by the same consent (ePrivacy Art. 5(3)). Under the Swiss nFADP (in force since
  1 September 2023) no legal basis is needed for this processing, but the duty to inform
  (Art. 19 nFADP) applies, which this notice is meant to meet.
- **What counts as personal data.** The install record is pseudonymous and so personal data under
  the GDPR. Feedback comments, attached answers and crash reports could contain personal data by
  accident and are treated as such (scrubbed twice, short retention). Exercise totals without an id
  are anonymous.
- **Data minimisation.** IP addresses are not stored; the rate-limit key is an HMAC of IP + day
  kept at most one hour. Raw install ids are never stored. Worker request logs are disabled
  (`[observability] enabled = false`). Don't turn on Logpush or analytics that keep IPs.
- **Location and transfers.** Create the D1 database with an EU location hint
  (`--location weur`). Cloudflare may still process traffic outside the EU/Switzerland; transfers
  to the US rely on the EU–US Data Privacy Framework and its Swiss–US extension (Cloudflare is
  certified) or the Standard Contractual Clauses in Cloudflare's DPA. Mention this, as above.
- **Records and requests.** Keep a short record of processing (GDPR Art. 30 / nFADP Art. 12; small
  operators may be exempt). Access and deletion requests: Art. 11 GDPR applies to the data you can't
  attribute; the install record is deleted through `POST /v1/forget`. Feedback and crashes can be
  deleted by hand in D1 (`npx wrangler d1 execute doppelpunkt-beta --remote --command "DELETE ..."`).
- **Retention** is enforced by the daily `scheduled()` handler; if you change it, change this
  notice too.
- **Contact placeholders** above must be filled in before the beta starts.
