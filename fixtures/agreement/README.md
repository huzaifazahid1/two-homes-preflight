# Demo agreement fixture

`demo-agreement.md` is a synthetic 6-page agreement (fictional people: Alex Rivera, Sara Rivera, Mia Rivera). It is written to exercise every Phase 2 path:

| Page | Clause | What it tests |
| --- | --- | --- |
| 1 | Parties and child | Family prefill (ON-5): parents Alex and Sara, child Mia born 2016 |
| 2 | 4.1 receipts within 30 days, 4.2 reimburse within 30 days | Deadlines with their own supporting quotes |
| 3 | 5.1 medical, dental, vision 50/50, no approval | $120 dentist is Eligible |
| 4 | 6.1 extracurricular 60/40, approval above $200 | $350 soccer camp is Needs approval citing p. 4; the other parent's share is $140 |
| 5 | 7.1 school supplies 50/50; 8.1 "reasonable" clothing | Vague-term badge |
| 6 | 9.1 repeats 6.1 word for word | A clause on two pages is merged, not reported as a conflict |

Not covered on purpose: travel, childcare (good for a "Not covered" demo).

## Owner: make the PDF (one time)

1. Open Google Docs (or Word), paste the whole of `demo-agreement.md`.
2. Replace each `--- Page N ---` line with a page break (Google Docs: Insert, Break, Page break), so the PDF has exactly 6 pages with the same content per page.
3. File, Download, PDF. Save it as `fixtures/agreement/demo-agreement.pdf`.

If the page breaks end up in slightly different places, nothing breaks: quotes are still verified, they just show "found on another page".

The `.md` file can also be pasted as-is into the "Paste the text" box: the `--- Page N ---` markers become page numbers.

## Recorded AI output

`fixtures/ai/demo-agreement-extraction.json` is the extraction used by demo mode (`DEMO_MODE=true` and Gemini unavailable). It goes through the same quote verification as a live answer. Re-record it with `npm run ai:check-extraction` (uses the real Gemini key from `.env.local`).
