# Our Money

A private, mobile-first household expense app built with Next.js + Firebase.

## v1 changes in this package

- Reopens the last-used household automatically
- Uses the named Firestore database `budgetdb`
- Silently authenticates each phone/PWA with Firebase Anonymous Auth
- Adds household membership UIDs and invite-based joining
- Includes locked-down Firestore rules (`firestore.rules`)
- Rolls recurring expenses into the next month when you archive
- Makes **Safe to spend** reserve the rest of your category budgets first
- Adds a 50/50 settle-up card for two-person households
- Stores expenses and monthly history as separate Firestore records so routine
  edits do not rewrite the household's entire history or hit the 1 MiB document limit

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Required one-time Firebase setup

The project is already configured for Firebase project `our-money-app-1031` and the named Firestore database `budgetdb`.

### 1. Enable Anonymous Authentication

In Firebase Console:

1. Authentication → Get started
2. Sign-in method
3. Enable **Anonymous**

This does not show you or your partner a login screen. It simply gives each installed browser/PWA a private Firebase UID that Firestore rules can authorize.

### 2. Deploy the included Firestore rules

The secure rules are in `firestore.rules`. They prevent household collection listing and restrict financial data to joined household device UIDs.

You can paste the file into the Rules tab for `budgetdb`, or use Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase use our-money-app-1031
firebase deploy --only firestore:rules
```

**Do not leave Firestore in test mode for real financial data.**

## Database storage design

To make a small Firestore quota last, the `households/{code}` document contains
only configuration, income, membership, and sync metadata. Current expenses are
stored at `households/{code}/expenses/{id}` and archived months at
`households/{code}/history/{yearMonth}`. Sync compares records and writes only
the ones that changed. Deleting a household also deletes these records in safe,
bounded batches, so removed households do not continue using database storage.

Existing array-based households migrate automatically on their next successful
sync: records are copied to the subcollections and the old arrays are removed.

### Existing household migration

The rules include a one-time migration path for household documents created by the previous test-mode version. Open the app once on the phone/browser that already has the household cached; the next sync will add that device UID and create the invite record. After that, the second phone can join with the existing six-character code.

## Install on phones

Once deployed over HTTPS:

### iPhone
1. Open in Safari
2. Share
3. Add to Home Screen

### Android
1. Open in Chrome
2. Browser menu
3. Install app / Add to Home screen

## How Safe to Spend now works

The hero number is conservative:

```text
monthly take-home
- savings goal
- expenses already entered
- remaining unused category budgets
= safe-to-spend cushion
```

So money still earmarked for rent, groceries, utilities, dining, travel, etc. is no longer presented as free cash.

## Automatic monthly archive (October 2026 update)

New households track their active calendar month in Firestore from day one.
Existing households show a **Track this month** action once; enable it to opt in
without moving or changing any existing expenses. After enabling, on the first
app open in a subsequent month (on either device) the app automatically:

1. Archives the last open month as a snapshot in History.
2. Moves recurring expense templates into the current calendar month.
3. Resets the current month's actual-income override.
4. Synchronizes the new active month to other phones.

This happens **on app open, not at midnight in the background**. When the app
has not been opened for multiple months, it archives the last open month and
continues in the present month; it does not invent intervening expense history.
Firestore performs the archive and rollover atomically with a shared month
guard to prevent duplicate archives. Extremely large months are blocked rather
than partially archived. If the archive fails, the old month remains in place
and the dashboard presents a manual retry option.

## Other quality-of-life improvements

- Recent merchant/description suggestions in the expense form can preselect
  a previously used category and payer.
- Undo a deleted expense for eight seconds.
- Savings forecasts distinguish recurring entries already recorded from the
  remaining variable spending pace.
- Monthly top categories, top descriptions, and last-three-month trend tables.
- Local date handling and truthful negative safe-to-spend displays.

## Recurring expenses

Mark an expense **Recurring monthly**. When the month is archived, it is copied into the next month with a new ID and the same calendar day (clamped to month-end where needed).

## Settle-up card

If the household has exactly two named people (plus optional `Joint`), the dashboard calculates a simple 50/50 balance using expenses paid personally. Expenses paid by `Joint` are excluded from the settle-up difference.

## Backups

Settings still supports JSON backup/import and CSV export.
