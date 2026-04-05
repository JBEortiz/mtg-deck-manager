import "server-only";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPasswordValidationErrors, normalizeEmail, validateLoginInput, validateRegistrationInput } from "@/lib/auth-validation";
import type { User } from "@/lib/types";
import { createStoredSession, createStoredUser, deleteStoredSession, getSessionById, getUserByEmail, getUserById } from "@/lib/server/mtg-store";
import { hashPassword, verifyPassword } from "@/lib/server/passwords";

export const SESSION_COOKIE_NAME = "mtg_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30;

export type AuthErrorCode =
  | "invalid_email"
  | "invalid_password"
  | "password_mismatch"
  | "email_in_use"
  | "invalid_credentials"
  | "unauthenticated";

export class AuthError extends Error {
  code: AuthErrorCode;
  details: string[];

  constructor(code: AuthErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.details = details;
  }
}

function sanitizeUser(user: Awaited<ReturnType<typeof getUserById>> extends infer T ? Exclude<T, null> : never): User {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    isBootstrapLegacyOwner: user.isBootstrapLegacyOwner
  };
}

function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  };
}

export async function registerUser(input: { email: string; password: string; confirmPassword: string }) {
  const validation = validateRegistrationInput(input);
  const email = validation.normalizedEmail;
  const password = input.password;

  if (!validation.isValid) {
    const firstError = validation.fieldErrors.email ?? validation.fieldErrors.password ?? validation.fieldErrors.confirmPassword ?? "No se pudo crear la cuenta.";
    const details = Object.values(validation.fieldErrors);
    if (validation.fieldErrors.confirmPassword) {
      throw new AuthError("password_mismatch", firstError, details);
    }
    if (validation.fieldErrors.email) {
      throw new AuthError("invalid_email", firstError, details);
    }
    throw new AuthError("invalid_password", firstError, details);
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    throw new AuthError("email_in_use", "Ya existe una cuenta con ese email.");
  }

  const passwordHash = await hashPassword(password);
  const user = await createStoredUser({ email, passwordHash });
  return sanitizeUser(user);
}

export async function authenticateUser(input: { email: string; password: string }) {
  const validation = validateLoginInput(input);
  const email = validation.normalizedEmail;
  const password = input.password;

  if (!validation.isValid) {
    const firstError = validation.fieldErrors.email ?? validation.fieldErrors.password ?? "No se pudo iniciar sesion.";
    const details = Object.values(validation.fieldErrors);
    if (validation.fieldErrors.email) {
      throw new AuthError("invalid_email", firstError, details);
    }
    throw new AuthError("invalid_password", firstError, details);
  }

  const user = await getUserByEmail(email);

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new AuthError("invalid_credentials", "Email o contrasena incorrectos.");
  }

  return sanitizeUser(user);
}

export async function createSessionForUser(userId: number) {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await createStoredSession({
    id: sessionId,
    userId,
    expiresAt: expiresAt.toISOString()
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions(expiresAt));
  return { sessionId, expiresAt };
}

export async function clearCurrentSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionId) {
    await deleteStoredSession(sessionId);
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) {
    return null;
  }

  const session = await getSessionById(sessionId);
  if (!session) {
    cookieStore.delete(SESSION_COOKIE_NAME);
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await deleteStoredSession(session.id);
    cookieStore.delete(SESSION_COOKIE_NAME);
    return null;
  }

  return session;
}

export async function getCurrentUser() {
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }

  const user = await getUserById(session.userId);
  if (!user) {
    await clearCurrentSession();
    return null;
  }

  return sanitizeUser(user);
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError("unauthenticated", "Debes iniciar sesion.");
  }
  return user;
}

export async function redirectIfUnauthenticated(nextPath?: string) {
  const user = await getCurrentUser();
  if (!user) {
    const suffix = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
    redirect(`/sign-in${suffix}`);
  }
  return user;
}
