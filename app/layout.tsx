import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { getCurrentUser } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "MTG Deck Manager",
  description: "Gestion de decks, cartas y ayuda de reglas para Magic desde una unica app Next.js"
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const currentUser = await getCurrentUser();
  return (
    <html lang="es">
      <body>
        <AppShell currentUser={currentUser}>{children}</AppShell>
      </body>
    </html>
  );
}
