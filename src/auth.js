import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool } from './db.js';
import { createOpaqueToken, hashOpaqueToken, hashPassword, verifyPassword, safeEqualBuffers } from './security/credentials.js';

const COOKIE_NAME = 'osint_session';
const SESSION_DAYS = 7;

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
  });
}

export async function requireAuth(req, res, next) {
  try {
    if (!pool) return res.status(503).json({ error: 'La base OSINT n’est pas configurée.' });
    const token = readCookie(req, COOKIE_NAME);
    if (!token) return res.status(401).json({ error: 'Connexion requise.' });
    const result = await pool.query(
      `SELECT s.id AS session_id, s.csrf_hash, u.id, u.email, u.display_name, u.status,
              COALESCE((SELECT array_agg(r.role_key) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), ARRAY[]::text[]) AS roles
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()
         AND s.revoked_at IS NULL AND u.status = 'active'`,
      [hashOpaqueToken(token)]
    );
    if (!result.rowCount) return res.status(401).json({ error: 'Session expirée ou invalide.' });
    const roles = result.rows[0].roles || [];
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    if (adminEmails.includes(result.rows[0].email.toLowerCase()) && !roles.includes('admin')) roles.push('admin');
    req.user = { id: result.rows[0].id, email: result.rows[0].email, displayName: result.rows[0].display_name, roles };
    req.session = { id: result.rows[0].session_id, csrfHash: result.rows[0].csrf_hash };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireCsrf(req, res, next) {
  const supplied = req.get('x-csrf-token');
  if (!supplied || !safeEqualBuffers(hashOpaqueToken(supplied), req.session?.csrfHash)) {
    return res.status(403).json({ error: 'Jeton CSRF absent ou invalide.' });
  }
  const origin = req.get('origin');
  if (origin) {
    try {
      const expected = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
      if (new URL(origin).origin !== new URL(expected).origin) {
        return res.status(403).json({ error: 'Origine non autorisée.' });
      }
    } catch {
      return res.status(403).json({ error: 'Origine invalide.' });
    }
  }
  next();
}

const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(2).max(60),
  password: z.string().min(12).max(128)
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128)
});

async function issueSession(client, userId, res) {
  const token = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await client.query(
    'INSERT INTO user_sessions(user_id, token_hash, csrf_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, hashOpaqueToken(token), hashOpaqueToken(csrfToken), expiresAt]
  );
  setSessionCookie(res, token);
  return csrfToken;
}

export function createAuthRouter() {
  const router = Router();
  const registerLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 3, standardHeaders: 'draft-8', legacyHeaders: false });
  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });

  router.post('/register', registerLimit, async (req, res, next) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Données invalides. Mot de passe : 12 caractères minimum.' });
    if (!pool) return res.status(503).json({ error: 'Inscription indisponible : base de données non configurée.' });
    const email = parsed.data.email.toLowerCase();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const passwordHash = await hashPassword(parsed.data.password);
      const inserted = await client.query(
        'INSERT INTO users(email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name',
        [email, parsed.data.displayName, passwordHash]
      );
      const user = inserted.rows[0];
      await client.query(
        `INSERT INTO user_roles(user_id, role_id)
         SELECT $1, id FROM roles WHERE role_key = 'user'
         ON CONFLICT DO NOTHING`,
        [user.id]
      );
      const csrfToken = await issueSession(client, user.id, res);
      await client.query('COMMIT');
      res.status(201).json({ user, csrfToken });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée.' });
      next(error);
    } finally {
      client.release();
    }
  });

  router.post('/login', loginLimit, async (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Identifiants invalides.' });
    if (!pool) return res.status(503).json({ error: 'Connexion indisponible : base de données non configurée.' });
    try {
      const result = await pool.query(
        'SELECT id, email, display_name, password_hash FROM users WHERE LOWER(email) = LOWER($1) AND status = $2',
        [parsed.data.email, 'active']
      );
      const user = result.rows[0];
      if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
        return res.status(401).json({ error: 'Adresse e-mail ou mot de passe incorrect.' });
      }
      const client = await pool.connect();
      try {
        const csrfToken = await issueSession(client, user.id, res);
        res.json({ user: { id: user.id, email: user.email, display_name: user.display_name }, csrfToken });
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', requireAuth, async (req, res) => {
    const roles = await pool.query(
      'SELECT r.role_key FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = $1',
      [req.user.id]
    );
    res.json({ user: req.user, roles: roles.rows.map(row => row.role_key) });
  });

  router.get('/csrf', requireAuth, async (req, res, next) => {
    try {
      const csrfToken = createOpaqueToken();
      await pool.query('UPDATE user_sessions SET csrf_hash = $1, last_seen_at = NOW() WHERE id = $2', [hashOpaqueToken(csrfToken), req.session.id]);
      res.json({ csrfToken });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      await pool.query('UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1', [req.session.id]);
      res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Connexion requise.' });
    if (!Array.isArray(req.user.roles) || !req.user.roles.includes(role)) {
      return res.status(403).json({ error: 'Permission insuffisante.' });
    }
    next();
  };
}
