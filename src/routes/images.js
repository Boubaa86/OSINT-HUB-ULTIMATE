import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import exifr from 'exifr';
import { fileTypeFromBuffer } from 'file-type';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { pool } from '../db.js';
import { requireAuth, requireCsrf } from '../auth.js';

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/tiff']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1, fieldSize: 128 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype?.startsWith('image/')) callback(null, true);
    else callback(new Error('IMAGE_ONLY'));
  }
});

const safeExifKeys = [
  'Make', 'Model', 'Software', 'DateTimeOriginal', 'CreateDate', 'ModifyDate',
  'Orientation', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'LensModel',
  'ColorSpace', 'WhiteBalance'
];

function normalizeExif(value) {
  const output = {};
  for (const key of safeExifKeys) {
    const item = value?.[key];
    if (item instanceof Date) output[key] = item.toISOString();
    else if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') output[key] = item;
  }
  return output;
}

async function differenceHash(buffer) {
  const { data } = await sharp(buffer, { limitInputPixels: 20_000_000 })
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = 0n;
  let index = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (data[y * 9 + x] > data[y * 9 + x + 1]) bits |= 1n << index;
      index += 1n;
    }
  }
  return bits.toString(16).padStart(16, '0');
}

function hammingDistance(left, right) {
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (bits) {
    count += Number(bits & 1n);
    bits >>= 1n;
  }
  return count;
}

export function createImageRouter() {
  const router = Router();
  router.use(requireAuth);
  router.use(rateLimit({ windowMs: 60_000, limit: 4, standardHeaders: 'draft-8', legacyHeaders: false }));

  router.post('/', requireCsrf, (req, res, next) => {
    upload.single('image')(req, res, error => {
      if (!error) return next();
      const message = error.code === 'LIMIT_FILE_SIZE' ? 'Image limitée à 8 Mo.' : 'Fichier image refusé.';
      return res.status(400).json({ error: message });
    });
  }, async (req, res, next) => {
    if (!req.file?.buffer) return res.status(400).json({ error: 'Fichier image manquant.' });
    try {
      const detected = await fileTypeFromBuffer(req.file.buffer);
      if (!detected || !allowedTypes.has(detected.mime)) {
        return res.status(400).json({ error: 'Formats acceptés : JPEG, PNG, WebP et TIFF.' });
      }

      const metadata = await sharp(req.file.buffer, { limitInputPixels: 20_000_000 }).metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > 20_000_000) {
        return res.status(400).json({ error: 'Dimensions d’image invalides ou trop importantes.' });
      }

      let rawExif = {};
      try { rawExif = await exifr.parse(req.file.buffer) || {}; } catch {}
      const exif = normalizeExif(rawExif);
      const sha256 = createHash('sha256').update(req.file.buffer).digest('hex');
      const dhash = await differenceHash(req.file.buffer);
      const parsedCase = z.string().uuid().safeParse(req.body.investigationId);
      const investigationId = req.body.investigationId ? (parsedCase.success ? parsedCase.data : null) : null;
      if (req.body.investigationId && !investigationId) {
        return res.status(400).json({ error: 'Identifiant de dossier invalide.' });
      }
      if (investigationId) {
        const owned = await pool.query('SELECT id FROM investigations WHERE id = $1 AND owner_id = $2', [investigationId, req.user.id]);
        if (!owned.rowCount) return res.status(404).json({ error: 'Dossier introuvable.' });
      }

      const existing = await pool.query(
        'SELECT id, sha256, dhash, created_at FROM image_records WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 500',
        [req.user.id]
      );
      const duplicates = existing.rows
        .map(row => ({
          id: row.id,
          exactMatch: row.sha256 === sha256,
          distance: hammingDistance(row.dhash, dhash),
          createdAt: row.created_at
        }))
        .filter(row => row.exactMatch || row.distance <= 4)
        .slice(0, 20);

      const safeMetadata = {
        format: metadata.format || detected.ext,
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation || null,
        space: metadata.space || null,
        hasAlpha: Boolean(metadata.hasAlpha),
        exif
      };
      const saved = await pool.query(
        `INSERT INTO image_records(owner_id, investigation_id, sha256, dhash, file_size, mime_type, width, height, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, created_at`,
        [req.user.id, investigationId, sha256, dhash, req.file.size, detected.mime, metadata.width, metadata.height, safeMetadata]
      );

      res.status(201).json({
        imageId: saved.rows[0].id,
        collectedAt: saved.rows[0].created_at,
        sha256,
        differenceHash: dhash,
        file: { size: req.file.size, mimeType: detected.mime },
        metadata: safeMetadata,
        duplicateCandidates: duplicates,
        duplicateCount: duplicates.length,
        source: 'Local image metadata and hash analysis',
        privacy: 'GPS coordinates, serial numbers and image bytes are not stored. No face recognition or OCR is performed.'
      });
    } catch (error) {
      if (error.message === 'Input image exceeds pixel limit') return res.status(400).json({ error: 'Image trop grande.' });
      next(error);
    }
  });

  return router;
}
