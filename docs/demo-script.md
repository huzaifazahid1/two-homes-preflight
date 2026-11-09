# Demo script

Source: Appendix 2 of the original blueprint. Claude Code keeps this file current in Phase 4.

# Appendix 2. Demo script (video, about 2:30)

Synthetic family: Alex (owner, Family plan), Sara (co-parent, guest), Mia (child). Fixture agreement (6 pages) with: medical 50/50 no approval; extracurricular 60/40 with written approval above $200 (p. 4); school supplies 50/50; receipts within 30 days; one vague "reasonable expenses" clause; one clause repeated on two pages.

| # | Screen | Show | Pass |
| --- | --- | --- | --- |
| 1 | `/app/agreement` | Upload, extraction | Rules with quote + page; vague badge |
| 2 | `/app/agreement/review` | Source view highlight; confirm | Unverified quote cannot be confirmed |
| 3 | `/app/expenses/new` | Quick add "Mia soccer camp $350 next Saturday" | Needs approval, "above $200, p. 4" |
| 4 | same | Dentist $120 | Eligible, no approval |
| 5 | Sara's phone `/a/[token]` | Code, clause, share $140 | No install |
| 6 | Alex's screen | Approved appears live | Listener |
| 7 | Receipt upload | AI reads total, matches approval | Ready |
| 8 | Sara `/p/[token]` | Pays with PayPal sandbox | Capture COMPLETED |
| 9 | Expense timeline | Paid, payout processing, settled | Payout batch id |
| 10 | `/app/ledger` | AG Grid with clause, badges, totals, CSV | |
| 11 | `/app/billing` | Family plan, covered volume | |

Edge clips (20 to 30 s): duplicate receipt blocked; re-request after decline blocked for 7 days; hallucinated quote cannot be confirmed; overdue claim on dashboard; free plan shows upgrade on settlement.

Pre-demo checklist: reset + seed; warm up Render; fund platform sandbox balance; sandbox buyer and receiver logins ready; Gemini quota; demo mode toggle ready; two browser profiles (Alex, Sara).

## Phase 4 notes (kept current)

- Reset and seed: `/dev/demo` (needs `DEMO_MODE=true` and `DEV_SECRET`) or `npm run reset` then `npm run seed -- --coparent=<Sara's inbox> --paypal=<owner sandbox receiver email>`. Sign in with the owner credentials it prints.
- Step 8 needs the Family plan: subscribe on `/app/billing` with a sandbox personal account before recording (the trial starts at once).
- Step 9 shows "Paid in the app" with the payout batch id on the expense page; "Settled" arrives with the `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` webhook (ngrok locally, Render URL in prod). If the webhook is slow, "Check with PayPal" re-syncs.
- Step 10: `/app/ledger` on desktop: show the clause chip opening the source view, the Overdue only filter, select two rows and "Export 2 selected".
- Step 11: `/app/billing`: Family, next payment, covered-volume bar.
- Extra checklist: platform sandbox balance funded; `PAYPAL_WEBHOOK_ID` matches the app; `npm run invariants` shows zero violations after the run.
