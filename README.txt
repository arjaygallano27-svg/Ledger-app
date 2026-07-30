LEDGER — installable expense tracker
=====================================

This is a Progressive Web App (PWA). To install it on your phone as a
real app icon (works offline, no browser bar), it needs to be served
over HTTPS first — phones won't let you "Add to Home Screen" properly
from a plain local file. The easiest free way to do that is GitHub
Pages. Takes about 5 minutes, no coding required.

STEP 1 — Create a GitHub account (skip if you have one)
  Go to https://github.com/signup and create a free account.

STEP 2 — Create a new repository
  1. Click the "+" in the top right -> "New repository"
  2. Name it something like "ledger-app"
  3. Set it to Public
  4. Click "Create repository"

STEP 3 — Upload these files
  1. On your new repo's page, click "Add file" -> "Upload files"
  2. Drag in ALL the files from this folder (index.html, style.css,
     app.js, manifest.json, sw.js, and the icons folder)
  3. Click "Commit changes"

STEP 4 — Turn on GitHub Pages
  1. Go to your repo's "Settings" tab
  2. Click "Pages" in the left sidebar
  3. Under "Branch", choose "main" and folder "/ (root)", then Save
  4. GitHub will give you a URL like:
     https://YOUR-USERNAME.github.io/ledger-app/
     (it can take 1-2 minutes to go live)

STEP 5 — Install it on your phone
  1. Open that URL in Safari (iPhone) or Chrome (Android)
  2. iPhone: tap the Share icon -> "Add to Home Screen"
     Android: tap the ⋮ menu -> "Install app" or "Add to Home Screen"
  3. A "Ledger" icon appears on your home screen. Tap it — it opens
     full-screen like a real app, and keeps working without internet.

Your data (loans, salary, payments) is saved directly on your phone
in the app itself — nobody else can see it, and it stays even if you
lose signal or close the app.

NEW: PAYMENT SCREENSHOTS AND REMINDERS
=======================================
Screenshots: open any account and tap "+ Add screenshot" to attach a
photo of your payment confirmation. It's stored on your phone (tap a
thumbnail to view it full-size, or the x to delete it).

Reminders: tap "Download calendar reminders (.ics)" and open the
downloaded file — your phone will offer to add it to Calendar
(Apple Calendar / Google Calendar). This gives you a real notification
2 days before each payment and again on the due date, and it keeps
working even if you never open this app again or lose signal.

There's also an "Enable in-app notifications" button for a bonus
reminder banner while the app is open — but note this ONLY works
while the app is open on your screen; it can't wake your phone up
on its own. The calendar file is the reliable way to get notified.

SUMMARY TAB
===========
Tap "Summary" at the top (next to "Accounts") to see:
  - Totals across all your loans: total borrowed, paid so far,
    remaining, and the date you'll be debt-free
  - A year-by-year table of what you'll pay and what's left,
    collapsing years where nothing changes into a single range
    (e.g. "2029-2055") so it stays readable even for a 30-year loan

Note: remaining-balance figures are an approximation for interest-
bearing loans like Pag-IBIG, since the app only tracks how many
payments you've made, not the bank's real amortization schedule.

MONTHLY TAB
===========
Tap "Monthly" for a detailed month-by-month table (36 months ahead) -
one row per month, one set of columns per loan showing the payment
amount and running remaining balance, plus a date box where you can
log the actual date you paid (for your own records only, it doesn't
change any calculations). Scroll sideways to see every column.


To update it later (e.g. change a loan amount for everyone, not just
yourself), edit the files and re-upload them the same way in Step 3.
