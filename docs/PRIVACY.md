# Privacy policy

*Last updated: 2026-10-25. Applies to the Doppelpunkt app, its landing page, the optional payment
service and the optional beta programme.*

Doppelpunkt is built to work without sending anything to us. Your progress, your answers and your
AI keys stay on your device, and you need no account. We only receive data when you **buy or
restore an unlock, redeem a book code**, or **switch on a beta option**. This policy explains each
case. The operator responsible for Doppelpunkt is named in the [imprint](/imprint).

## The short version

- No account, no tracking, no advertising, no third-party trackers, no cookies for analytics.
- Learning progress, settings, encrypted AI keys and unlock tokens are stored **only on your device**.
- AI features use **your own key** and talk **directly to the AI provider you choose** (or through a
  relay you set up). We never see your key or your conversations.
- **Payments** are handled by **Stripe**. We never see your card details. Our billing server keeps a
  random purchase id, the product, Stripe references and a keyed hash of your email address, not
  the address itself.
- **Book codes** are stored on our server only as keyed hashes; redeeming one sends no personal data.
- The **beta options** (feedback reports, item statistics, crash reports) all start switched off.

## Who is responsible

The controller under the Swiss Federal Act on Data Protection (nFADP) and the EU General Data
Protection Regulation (GDPR) is:

**[OPERATOR NAME]**, **[STREET AND NUMBER]**, **[POSTCODE AND CITY]**, **[COUNTRY]**
Contact for privacy questions: **[PRIVACY CONTACT EMAIL]**

**[EU REPRESENTATIVE (Art. 27 GDPR), if required: NAME AND ADDRESS, or remove this line]**

## On your device

The app stores in your browser's storage (IndexedDB): your progress and answers, review schedule,
settings, your AI keys (encrypted with your passphrase, AES-GCM), and your unlock tokens. None of
it is sent to us. "Export progress" in Settings writes it to a file for you (without the AI keys);
"Reset everything" deletes it. The app also keeps your theme choice in local storage. The service
worker caches the app and the lessons so they work offline.

## Loading the app and the landing page

The app is a set of static files served by our hosting provider **[HOSTING PROVIDER, e.g. GitHub
Pages (GitHub, Inc., USA) or Cloudflare Pages (Cloudflare, Inc., USA)]**. Like every web server, it
processes your IP address and browser details to deliver the files and to protect itself against
abuse, and it may keep them in its logs for a short time under its own policy. We do not run
analytics on these logs. Lesson audio may be served from a storage service (**[AUDIO CDN, e.g.
Cloudflare R2, or remove]**) in the same way.

## AI tutors (your own key)

If you add an API key, AI requests (your messages, the exercise and your answer when you ask for
feedback, and recordings when you use speech transcription) go **directly from your device to the
provider you chose**: Anthropic, OpenAI, Google (Gemini) or xAI. That provider processes them under
its own terms and privacy policy, as your contractual partner; we are not involved and receive
nothing. If you enter a relay URL, requests pass through that relay; only use a relay you run or
trust. Our optional relay (`services/relay`) stores and logs nothing.

## Payments

A1 is free. When you buy a level or the yearly pass, the app asks our billing server to open a
**Stripe Checkout** page, and you pay on Stripe's site.

- **Stripe** (Stripe Payments Europe, Ltd., Ireland, and Stripe, Inc., USA) processes your email
  address, payment details, billing country and technical data such as your IP address, to take the
  payment, send the receipt and prevent fraud. Stripe acts as our processor for the payment and as
  an independent controller for its own legal and fraud-prevention duties. See
  [stripe.com/privacy](https://stripe.com/privacy).
- **We** can see in Stripe's dashboard what we need for bookkeeping, refunds and support: the email
  address, the amount, the product, the country and the payment status. We never see the full card
  number.
- **Our billing server** (a Cloudflare Worker with a Cloudflare D1 database in a European location)
  stores for each purchase: a random **purchase id** (`dp_…`), the product, the Stripe Checkout
  session id and payment id, a **keyed hash of your email address** (HMAC-SHA-256; the address
  itself is not stored), the unlock token it issued, whether the purchase was refunded, and the
  time. It does not store your name, your address, card data or your IP address, and it keeps no
  request logs. To stop people from guessing codes, it turns your IP address and the date into a
  short keyed hash that is kept in memory for at most one hour, only to count requests.
- **The unlock token** saved on your device contains only the purchase id, the product, the
  unlocked levels and the issue and expiry dates. It contains no personal data.
- **Restore a purchase:** you send your email address and the purchase id (or the checkout
  reference). The server hashes the email and compares it with the stored hash; it does not keep
  what you sent.
- **Legal basis:** performing the contract with you (GDPR Art. 6(1)(b)) and our legal duty to keep
  accounting records (Art. 6(1)(c)).
- **How long:** purchase records and the Stripe records are kept for **10 years** after the end of
  the business year, as Swiss law (Art. 958f of the Code of Obligations) and EU accounting rules
  require. Refunded purchases are kept for the same period.

## Book access codes

Book 1 contains a code that unlocks A2. When you redeem it, the app sends the code to our billing
server. The server stores codes only as keyed hashes, counts how often a code was used, and stores
the purchase id and token it issued, with the time. No personal data is involved. These records are
kept as long as the book is sold, plus 10 years for bookkeeping.

## Beta programme (optional)

During the beta you can choose to help us find bad exercises by sharing three kinds of data. **All
three start switched off**, and you can switch each one on or off at any time in the beta section
of **Settings**. In builds without the beta server, these options are not shown and nothing is sent.

### What you can share

#### 1. "This is wrong / unclear" reports

You send these yourself, from the exercise screen. A report contains:

- which exercise and unit it is about, and the app and content version
- the reason you picked (wrong answer, unclear, typo, audio, Swiss form, other)
- your comment, if you write one (up to 500 characters). **Please don't put personal details in it.**
- your answer, only if you tick "include my answer"
- the time you sent it

Reports carry no install id, so we can't link several reports to each other or to you.

#### 2. Item statistics

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

#### 3. Crash reports

If you switch this on, the app sends a report when it crashes: the error name and message, the
technical stack trace (with file paths shortened to the app's own file names), the screen you were
on (without any query), the browser name and version, the app version and the time. Before
sending, the app removes email addresses, web addresses with parameters and long numbers from the
text. The server removes them again in case something slipped through.

### What the beta never collects

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

### How long the beta keeps it

Crash reports 90 days, reports one year, the install record until 120 days after your last upload
(see the table below). Deletion runs automatically once a day.

### Switching off and deleting

- **Statistics off:** the app deletes the install id and the counts it hasn't sent yet, and tells
  the server to delete your install record. If you are offline, it does this the next time you are
  online. Totals you already sent stay, because they can't be linked to you.
- **Crash reports off:** reports that have not been sent yet are deleted from your device.
- **Reports** can't be linked to you by us. If you want one removed, write to us with the exercise
  and the approximate time and we will look for it.
- **Delete everything on your device:** Settings → Your data → Reset everything, or clear the site
  data in your browser.

## Where the data is

Our billing server and the beta server are Cloudflare Workers with Cloudflare D1 databases. We run
them in a European data location. Cloudflare acts as our processor and may handle network traffic
outside Switzerland and the EU, for example in the United States. Stripe processes payment data in
the EU and the United States. Transfers to the United States rely on the EU–US Data Privacy
Framework and its Swiss–US extension (Cloudflare and Stripe are certified) or on the Standard
Contractual Clauses in their data processing agreements. Only the operator can read the data.

## How long we keep it

| Data | Kept for |
| --- | --- |
| Purchase records (purchase id, product, Stripe references, email hash, token) | 10 years after the end of the business year |
| Book code records (code hash, use count, issued purchase ids) | while the book is sold, plus 10 years |
| Beta crash reports | 90 days |
| Beta "wrong / unclear" reports | 1 year |
| Beta install record (hashed id, first week, last day, active weeks) | until 120 days after your last upload, or until you switch statistics off |
| Beta exercise totals (no id) | as long as we improve the course; they are anonymous |

## Your rights and contact

You can ask what we hold about you, ask us to correct or delete it, ask for a copy (data
portability), object to processing, withdraw your consent at any time (switching off has effect
for the future), and complain to a data protection authority (in Switzerland the FDPIC, in the EU
the authority in your country). Records we must keep by law are deleted when that duty ends.

Because we don't know who you are, we can usually only find your data with your help: for a
purchase, send us the purchase id and the email address you used. For the beta install record you
don't need us: switching statistics off makes the app ask the server to delete it.

Contact: **[PRIVACY CONTACT EMAIL]** · Operator: **[OPERATOR NAME AND ADDRESS]** (see the
[imprint](/imprint))

---

## Notes for the operator (GDPR and Swiss nFADP)

*Not legal advice. Check with counsel before the public launch (v1.0 "Legal").*

- **Placeholders.** Every `[...]` in this file, `docs/legal/TERMS.md` and `docs/legal/IMPRINT.md`
  must be replaced with real details before payments are switched on. The app shows a warning on
  these pages while placeholders remain.
- **Payments.** You are the controller; Stripe is your processor for the payment (accept Stripe's
  DPA, part of the Stripe Services Agreement) and an independent controller for its own duties.
  Cloudflare is the processor for the billing Worker and D1 (accept the Cloudflare DPA). The billing
  Worker stores only what is listed under "Payments"; keep `[observability] enabled = false`.
  `HASH_SECRET` keys the email and code hashes: keep it secret and stable.
- **Retention of purchases.** 10 years (Art. 958f CO; most EU states require 6–10 years). There is
  no automatic purge of `purchases` in D1; delete old rows yearly by hand once the period is over.

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
