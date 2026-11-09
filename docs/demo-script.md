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
