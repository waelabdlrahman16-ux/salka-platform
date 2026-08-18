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

## Enforcement

None, deliberately. This is a written rule, not a CI check -- Arabic sentence
length is a judgement call, and a hard gate would fail on exactly the legal and
payment strings that most need their length. Read this before writing copy.
