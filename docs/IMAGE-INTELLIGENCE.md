# Image Intelligence

`POST /api/osint/image` requires an authenticated session and CSRF token. Multipart field: `image`; optional field: `investigationId`.

- Accepts JPEG, PNG, WebP and TIFF after magic-byte detection.
- Upload limit: 8 MiB; decoded pixel limit: 20 million.
- Computes SHA-256 and a 64-bit difference hash (dHash).
- Reads dimensions, format and a small EXIF allowlist (camera make/model, software, capture/modify dates, exposure and lens metadata).
- Excludes GPS coordinates and serial numbers.
- Compares against the latest 500 image records belonging to the same user; exact SHA-256 matches and dHash distances <= 4 are returned as duplicate candidates.
- Stores only the hashes and sanitized metadata, not the uploaded image bytes.
- Does not perform OCR, reverse image search, face recognition or image execution.

The presence of an editing-software EXIF field is not proof that an image was manipulated. A perceptual-hash match is a similarity signal, not proof that two files are identical.
