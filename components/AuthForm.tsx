"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { validateLoginInput, validateRegistrationInput, type AuthFieldErrors, PASSWORD_MIN_LENGTH } from "@/lib/auth-validation";
import { ApiClientError, loginUser, registerUser } from "@/lib/api";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la operacion.";
}

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [successMessage, setSuccessMessage] = useState("");

  const isSignUp = mode === "sign-up";
  const nextPath = searchParams.get("next") || "/decks";

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
        await registerUser({ email, password, confirmPassword });
        setSuccessMessage("Cuenta creada correctamente. Entrando en tu espacio...");
      } else {
        await loginUser({ email, password });
        router.push(nextPath);
        router.refresh();
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
    </section>
  );
}
