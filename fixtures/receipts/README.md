# Demo receipts (synthetic)

Fictional businesses, fictional addresses (555 phone numbers), child "Mia R.". Each receipt says "SYNTHETIC RECEIPT FOR DEMO USE".

| File | What it is | Use in the demo |
| --- | --- | --- |
| `riverside-fc-soccer-camp.jpg` | Riverside FC summer camp, $325.00 + $25.00 registration = **$350.00**, dated 11/12/2026. Phone-photo style | Step 7: upload on the approved $350 soccer camp. AI reads $350.00, match OK, Ready. Sara's share $140.00 |
| `bright-smile-dental.jpg` | Bright Smile Dental, cleaning $95.00 + fluoride $25.00 = **$120.00**, dated 11/12/2026 | The eligible $120 dentist expense (no approval). Sara's share $60.00 |
| `riverside-fc-soccer-camp.pdf` | The same soccer receipt as a 1-page PDF (different file, same merchant, date and total) | Duplicate edge clips: upload the `.jpg` again on another expense to get "This exact receipt was already uploaded" (409); upload this PDF on another expense to get the "Possible duplicate" check |

Checked with the real Gemini model (`gemini-2.5-flash`, 2026-11-09): merchant, date, total and line items read correctly from all three in 2 to 3 seconds.

**Date:** all receipts are dated **Nov 12, 2026** (recording day). A receipt dated before the approval is flagged "Bought before approval", so the printed date must be on or after the day Sara approves. The app accepts a date at most one day ahead, so on Nov 11 and later these work as printed. If you test before Nov 11, the app refuses the future date: change the date in the confirm form to today.

The receipts were drawn with a one-off Python (Pillow) script that is not part of the project. Ask Claude Code to regenerate them if the dates or amounts need to change.
