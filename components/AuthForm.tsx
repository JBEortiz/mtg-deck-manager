"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { validateLoginInput, validateRegistrationInput, type AuthFieldErrors, PASSWORD_MIN_LENGTH } from "@/lib/auth-validation";
import { ApiClientError, loginUser, registerUser } from "@/lib/api";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
  initialError?: string;
  initialInfo?: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la operacion.";
}

function sanitizeNextPath(nextPath: string | null | undefined) {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/decks";
  }
  return nextPath;
}

export default function AuthForm({ mode, initialError = "", initialInfo = "" }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(initialError);
  const [info, setInfo] = useState(initialInfo);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [successMessage, setSuccessMessage] = useState("");

  const isSignUp = mode === "sign-up";
  const nextPath = sanitizeNextPath(searchParams.get("next"));

  useEffect(() => {
    if (!successMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      router.push(nextPath);
      router.refresh();
    }, 1200);

    return () => window.clearTimeout(timeoutId);
  }, [nextPath, router, successMessage]);

  const clearFieldError = (field: keyof AuthFieldErrors) => {
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      return { ...current, [field]: undefined };
    });
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setInfo("");
    setFieldErrors({});

    const validation = isSignUp
      ? validateRegistrationInput({ email, password, confirmPassword })
      : validateLoginInput({ email, password });

    if (!validation.isValid) {
      setFieldErrors(validation.fieldErrors);
      return;
    }

    setSaving(true);

    try {
      if (isSignUp) {
        const result = await registerUser({ email, password, confirmPassword });
        if (result.user.authProvider === "local" && result.user.emailVerified === false) {
          setInfo("Tu cuenta se creo con email. Verificaremos el correo en un siguiente paso sin bloquear tu acceso.");
        }
        setSuccessMessage("Cuenta creada correctamente. Entrando en tu espacio...");
      } else {
        const result = await loginUser({ email, password });
        if (result.user.authProvider === "local" && result.user.emailVerified === false) {
          setInfo("Tu email aun no esta verificado. Puedes seguir usando la app con normalidad.");
          setSuccessMessage("Sesion iniciada. Redirigiendo...");
        } else {
          router.push(nextPath);
          router.refresh();
        }
      }
    } catch (nextError) {
      if (nextError instanceof ApiClientError && nextError.errors.length > 0) {
        setError(nextError.message);
      } else {
        setError(getErrorMessage(nextError));
      }
    } finally {
      setSaving(false);
    }
  };

  if (successMessage) {
    return (
      <section className="panel auth-panel">
        <div className="section-header">
          <h2>Cuenta creada</h2>
          <p className="muted">Tu registro ya esta listo y la sesion se ha iniciado correctamente.</p>
        </div>
        <div className="notice-banner success-banner">
          <p>{successMessage}</p>
        </div>
        {info && <p className="notice-banner">{info}</p>}
        <div className="button-row">
          <button className="btn" type="button" onClick={() => { router.push(nextPath); router.refresh(); }}>
            Continuar
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel auth-panel">
      <div className="section-header">
        <h2>{isSignUp ? "Crear cuenta" : "Iniciar sesion"}</h2>
        <p className="muted">
          {isSignUp ? "Crea una cuenta para guardar y proteger tus decks." : "Accede para ver solo tus decks y datos."}
        </p>
      </div>

      <div className="button-row auth-social-row">
        <a className="btn secondary google-auth-btn" href={`/api/auth/google/start?next=${encodeURIComponent(nextPath)}`} aria-label="Continuar con Google">
          <span className="google-auth-icon" aria-hidden="true">
            <svg viewBox="0 0 18 18" role="img" focusable="false">
              <path fill="#EA4335" d="M9 7.4v3.3h4.7c-.2 1.1-.8 2-1.7 2.6l2.7 2.1c1.6-1.5 2.5-3.8 2.5-6.4 0-.6-.1-1.1-.2-1.6H9z" />
              <path fill="#34A853" d="M9 17.1c2.4 0 4.4-.8 5.9-2.1l-2.7-2.1c-.8.5-1.8.9-3.2.9-2.5 0-4.6-1.7-5.4-3.9L.8 12c1.5 3 4.6 5.1 8.2 5.1z" />
              <path fill="#4A90E2" d="M3.6 9.9c-.2-.5-.3-1-.3-1.6s.1-1.1.3-1.6L.8 4.6C.3 5.7 0 7 0 8.3s.3 2.6.8 3.7l2.8-2.1z" />
              <path fill="#FBBC05" d="M9 3.5c1.3 0 2.4.4 3.3 1.3l2.5-2.5C13.4.9 11.4 0 9 0 5.4 0 2.3 2.1.8 4.6l2.8 2.1C4.4 5.2 6.5 3.5 9 3.5z" />
            </svg>
          </span>
          Continuar con Google
        </a>
      </div>

      <p className="muted auth-divider">o usa email y contrasena</p>

      <form className="form" onSubmit={onSubmit}>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              clearFieldError("email");
            }}
            placeholder="tu@email.com"
            required
          />
          {fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}
        </label>
        <label className="field">
          <span>Contrasena</span>
          <input
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              clearFieldError("password");
              if (isSignUp) {
                clearFieldError("confirmPassword");
              }
            }}
            placeholder={`Minimo ${PASSWORD_MIN_LENGTH} caracteres`}
            required
          />
          {isSignUp && <p className="form-note">Usa al menos {PASSWORD_MIN_LENGTH} caracteres, una letra y un numero.</p>}
          {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
        </label>
        {isSignUp && (
          <label className="field">
            <span>Confirmar contrasena</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                clearFieldError("confirmPassword");
              }}
              placeholder="Repite la contrasena"
              required
            />
            {fieldErrors.confirmPassword && <p className="field-error">{fieldErrors.confirmPassword}</p>}
          </label>
        )}
        <button className="btn" type="submit" disabled={saving}>
          {saving ? (isSignUp ? "Creando..." : "Entrando...") : (isSignUp ? "Crear cuenta" : "Entrar")}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {info && <p className="notice-banner">{info}</p>}
    </section>
  );
}
