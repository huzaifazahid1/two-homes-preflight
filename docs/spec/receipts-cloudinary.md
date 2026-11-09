# Receipts (Cloudinary)

Part of the Two Homes Preflight spec. Source sections: I. Read `CLAUDE.md` first; it maps section letters to files.

# I. Cloudinary integration (receipts)

## I.1 Decisions [Agreed]

- Receipts only. Agreement PDFs are not stored (text only, Section E.2).
- Upload through **our server** (Route Handler), not directly from the browser, so we can check file type by magic bytes, size, and duplicate hash before anything is stored, and so no upload signature is exposed.
- Delivery type **`private`**: the original is only reachable through signed or download URLs. We never store a permanent URL in Firestore; we store `publicId` and metadata.
- Viewing: the API returns a time-limited URL generated with the Cloudinary **download API** (`cloudinary.utils.private_download_url(publicId, format, { resource_type: 'image', type: 'private', expires_at: now + 300 })`). Cloudinary documents that these URLs expire (default one hour) and are not CDN cached; at our volume that is fine. Never generate permanent signed delivery URLs for receipts.
- Token-based access and cookie-based access require paid Cloudinary plans and are **not** used.

## I.2 Upload flow

1. Client: `<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" capture="environment">`, shows preview, sends `multipart/form-data` to `POST /api/expenses/:id/receipts`.
2. Server (`route()` with `auth: user`): checks membership and that the expense can take a receipt (settlement `NONE` or `RECEIPT_ISSUE`).
3. Validates: size <= 10 MB; magic bytes match JPEG, PNG, WEBP, HEIC or PDF; PDF page count <= 5. Rejects otherwise with 400.
4. Computes SHA-256. In a transaction, creates `receiptHashes/{familyId}_{sha256}`; if it exists, returns 409 `DUPLICATE_RECEIPT` with the existing expense link.
5. Uploads to Cloudinary with the Node SDK `upload_stream`: `folder: 'two-homes/{env}/{familyId}'`, `type: 'private'`, `resource_type: 'image'` (Cloudinary treats PDFs as image resources), `public_id: receiptId`, `overwrite: false`, `unique_filename: false`, `tags: ['receipt', familyId]`, `context` with expenseId. No eager transformations.
6. If the Cloudinary upload fails: delete the `receiptHashes` doc (compensation), return 502 `UPLOAD_FAILED`, nothing else changes.
7. Writes `receipts/{receiptId}` with the Cloudinary response fields (`public_id`, `version`, `format`, `bytes`, `width`, `height`, `pages`, `asset_id`) and transitions settlement to `RECEIPT_SUBMITTED`.
8. Parsing: the server fetches the file through a fresh download URL, sends it to Gemini (inline data, image or PDF) with the receipt schema, validates, saves `parsed`. Parse failure leaves `parsed` empty and the UI asks for manual entry.
9. User confirms merchant, date, total. Match runs (Section M Phase 3). Settlement moves to `READY` or `RECEIPT_ISSUE`.

## I.3 Viewing
`GET /api/receipts/:id/url` checks membership (or link session for the payer on `/p/[token]`, which may view the receipt) and returns `{ url, expiresAt }`. The client opens it in a new tab or an `<img>`. Do not cache it.

## I.4 Deletion
When an expense is cancelled before any payment, the receipt may be deleted by the owner: `cloudinary.uploader.destroy(publicId, { type: 'private', resource_type: 'image' })`, then delete the Firestore docs. Receipts of paid claims are never deleted (they are evidence).

## I.5 Free-tier and settings notes
- Enable "Allow delivery of PDF and ZIP files" in Cloudinary Security settings (free accounts block PDF delivery by default).
- Usage counts against free credits (rolling 30 days). Receipts are small; no transformations are used.
- Environment: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (server only), `CLOUDINARY_FOLDER_PREFIX`.

## I.6 Security
- API secret never reaches the client. No unsigned upload presets.
- Folder per family; `publicId` is a random id, not a file name.
- Strip nothing from originals (evidence), but never display EXIF data.
- Rate limit uploads: 20 per family per hour.
