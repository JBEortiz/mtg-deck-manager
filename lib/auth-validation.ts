export const PASSWORD_MIN_LENGTH = 8;

export type AuthField = "email" | "password" | "confirmPassword";

export type AuthFieldErrors = Partial<Record<AuthField, string>>;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmailFormat(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function getPasswordValidationErrors(password: string) {
  const errors: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`La contrasena debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }

  if (!/[A-Za-z]/.test(password)) {
    errors.push("La contrasena debe incluir al menos una letra.");
  }

  if (!/\d/.test(password)) {
    errors.push("La contrasena debe incluir al menos un numero.");
  }

  return errors;
}

export function validateRegistrationInput(input: { email: string; password: string; confirmPassword: string }) {
  const normalizedEmail = normalizeEmail(input.email);
  const fieldErrors: AuthFieldErrors = {};

  if (!normalizedEmail) {
    fieldErrors.email = "Introduce tu email.";
  } else if (!isValidEmailFormat(normalizedEmail)) {
    fieldErrors.email = "Introduce un email valido.";
  }

  const passwordErrors = getPasswordValidationErrors(input.password);
  if (passwordErrors.length > 0) {
    fieldErrors.password = passwordErrors[0];
  }

  if (!input.confirmPassword.trim()) {
    fieldErrors.confirmPassword = "Confirma tu contrasena.";
  } else if (input.password !== input.confirmPassword) {
    fieldErrors.confirmPassword = "Las contrasenas no coinciden.";
  }

  return {
    normalizedEmail,
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0
  };
}

export function validateLoginInput(input: { email: string; password: string }) {
  const normalizedEmail = normalizeEmail(input.email);
  const fieldErrors: AuthFieldErrors = {};

  if (!normalizedEmail) {
    fieldErrors.email = "Introduce tu email.";
  } else if (!isValidEmailFormat(normalizedEmail)) {
    fieldErrors.email = "Introduce un email valido.";
  }

  if (!input.password) {
    fieldErrors.password = "Introduce tu contrasena.";
  }

  return {
    normalizedEmail,
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0
  };
}
