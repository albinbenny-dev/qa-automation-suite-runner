import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

interface TokenPayload {
  id: string;
  email: string;
  name: string;
  globalRole: string;
  iat?: number;
  exp?: number;
}

/**
 * verifyToken — Bearer JWT middleware.
 *
 * Reads Authorization: Bearer <token>, verifies against JWT_SECRET,
 * and attaches the decoded payload to req.user.
 *
 * Returns:
 *   401  Missing or malformed Authorization header
 *   401  Token expired
 *   401  Invalid token signature / payload
 *   500  JWT_SECRET not configured
 */
export async function verifyToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET is not set' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret);

    if (typeof decoded === 'string' || !decoded.sub && !('id' in decoded)) {
      res.status(401).json({ error: 'Invalid token payload' });
      return;
    }

    const payload = decoded as unknown as TokenPayload;

    // Live DB lookup — rejects deleted accounts and always uses current globalRole
    // so revoked or demoted users can't use stale JWT claims (F8).
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, globalRole: true },
    });
    if (!user) {
      res.status(401).json({ error: 'Account not found or has been removed' });
      return;
    }

    req.user = { ...payload, globalRole: user.globalRole };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired', expiredAt: err.expiredAt });
      return;
    }
    if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    next(err);
  }
}

/**
 * generateToken — create a signed JWT for a user.
 * Used by auth routes (Stage 3) — exported here to keep all JWT logic in one place.
 */
export function generateToken(user: { id: string; email: string; name: string; globalRole: string }): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');

  return jwt.sign(user, secret, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'],
  });
}
