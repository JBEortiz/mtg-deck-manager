"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { fetchHealth, logoutUser } from "@/lib/api";
import type { User } from "@/lib/types";

type AppShellProps = {
  children: React.ReactNode;
  currentUser: User | null;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Error desconocido";
}

const NAV_ITEMS = [
  { href: "/", label: "Inicio" },
  { href: "/decks", label: "Decks" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/assistant", label: "Asistente" }
];

export default function AppShell({ children, currentUser }: AppShellProps) {
  const pathname = usePathname();
  const [health, setHealth] = useState("");
  const [healthError, setHealthError] = useState("");
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const onCheckHealth = async () => {
    setHealth("");
    setHealthError("");
    setCheckingHealth(true);

    try {
      setHealth(await fetchHealth());
    } catch (error) {
      setHealthError(getErrorMessage(error));
    } finally {
      setCheckingHealth(false);
    }
  };

  const onLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutUser();
      window.location.href = "/sign-in";
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header-top">
          <div className="app-header-copy-block">
            <p className="eyebrow">MTG Deck Manager</p>
            <h1>Gestion de decks</h1>
            <p className="app-header-copy">
              Crea, importa, revisa y ajusta decks desde la app raiz.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn secondary" onClick={() => void onCheckHealth()} disabled={checkingHealth}>
              {checkingHealth ? "Comprobando API..." : "Comprobar API"}
            </button>
            {currentUser ? (
              <>
                <span className="status-badge">{currentUser.email}</span>
                <button className="btn secondary" onClick={() => void onLogout()} disabled={loggingOut}>
                  {loggingOut ? "Saliendo..." : "Salir"}
                </button>
              </>
            ) : (
              <>
                <Link className="btn secondary" href="/sign-in">Entrar</Link>
                <Link className="btn" href="/sign-up">Crear cuenta</Link>
              </>
            )}
            {health && <span className="status-badge status-ok">API: {health}</span>}
            {healthError && <span className="status-badge status-error">{healthError}</span>}
          </div>
        </div>

        <nav className="app-nav" aria-label="Principal">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === "/" ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link key={item.href} className={`nav-link${isActive ? " active" : ""}`} href={item.href}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="page-shell">{children}</div>
    </main>
  );
}
