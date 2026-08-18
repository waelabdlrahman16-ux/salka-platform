# How Salka writes

Agreed 2026-08-18, after Wael pointed at the logged-out orders screen and said
there was too much text.

## What the measurement actually found

Before changing anything, all 532 customer-visible strings were measured:

| | |
|---|---|
| median sentence | 25 characters |
| mean | 30 characters |
| over 80 characters | 10 strings (1.9%) |
| over 150 characters | 1 string |

So the app is **not** wordy in general. The writing is tight almost everywhere,
and the Egyptian Arabic voice is good and should not change.

What it has is **redundancy**. On the screen that started this, «سجّل دخولك»
appeared four times and «طلباتك» three times, between a heading, a subtitle, a
button and a paragraph -- four ways of saying *sign in to see your orders*, in
270 characters.

That is the real problem, and length is only its symptom. A 25-character line
repeated three times is worse than one 70-character line.

## The rules

**1. One idea per screen, said once.**
If the heading says it, the subtitle does not repeat it. A heading, a subtitle
and a button that all say the same thing give the reader three chances to skim
past instead of one chance to act.

**2. Put a message where it can be acted on, not where it explains itself.**
The screen that started this told people to save their tracking link -- on the
screen you land on *after* losing it. Advice for the future belongs at the
moment the thing appears, not at the moment it is already too late.

**3. Soft cap of about 80 characters per customer-facing sentence.**
98% of the app already passes. This is not a hard gate: payment terms, pharmacy
prescription notices and the cash-deposit explanation are legitimately longer,
and clarity beats brevity every time on a screen about money. If a sentence
needs 100 characters to stop someone losing money, it gets 100 characters.

**4. Staff tools are exempt.**
Admin, Vendor, Driver and Supervisor are dense on purpose. Someone who opens a
screen forty times a day wants information per glance, not whitespace. Do not
apply the customer cap to them. Redundancy is still worth removing.

**5. Say what happened and what to do next.**
Especially on failures. "حصل خطأ، جرب تاني" fails both halves: it does not say
what happened, and "try again" is not a next step when the thing is broken. The
checkout rewrite is the model -- name the state, then give the action.

**6. Never claim more certainty than the code has.**
The clearest example: when a request times out, the order may well have been
created. Saying "the order was not registered" there is how a restaurant ends
up cooking the same order twice. If the code does not know, the copy says so.

## House conventions, discovered the hard way

These are not style preferences, they are what the existing 2,553 strings already
do. Both of the rules below exist because copy written during the audit broke
them, and the break was only caught when Wael asked whether the words were real.

**Negated passives are written ما + ت + verb + ش, with one alif.**
The app already contains «ماتربطتش», «ماتحفظش», «ماتضيفش», «ماتسجلش». A checkout
message written during this audit used «مااتبعتش» -- two alifs, the only word of
that shape anywhere in the codebase -- and, worse, used both spellings of the
same construction inside a single sentence. Match what is already there.

**Quotation marks inside Arabic copy are guillemets: «...», never "...".**
Used throughout for screen names and item names -- «طلباتي», «حفظ وكمّل
الخيارات», «${it.name}». The same audit message used straight quotes around
"طلباتي".

Before adding a string, grep for a similar one already in the app and copy its
shape. The vocabulary here was written by people who run this business in Egypt;
matching it is more reliable than composing fresh.

**No em dashes in Arabic copy.**
The em dash is an English punctuation mark. 303 of them had accumulated across
the app; they are gone. What replaces one depends on what follows it:

  full stop   before an imperative -- «المكان ده قفل. جرب تاني بعدين»
  «،»         before a continuing clause -- «الطلب اتحرك خلاص، مش هينفع نغيّر»
  «:»         before a value or an error -- «الحفظ فشل: ${error.message}»

In code comments and docs the em dash becomes `--`, which the codebase already
used 900 times against 197 em dashes; this just finishes the job. Separators
between data fields in the UI (an order number and a restaurant name, a shift's
start and end) are not prose either: they take «·», or an en dash «–» for a
time range. `--` never belongs in text a customer reads.

Two uses of «—» are NOT punctuation and stay: the placeholder for an empty cell
(«{value ?? '—'}»), and separators between data fields in staff tables. Twelve
of those remain and are correct.

## Enforcement

None, deliberately. This is a written rule, not a CI check -- Arabic sentence
length is a judgement call, and a hard gate would fail on exactly the legal and
payment strings that most need their length. Read this before writing copy.
