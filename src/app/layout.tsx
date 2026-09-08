import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-app-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "queandabuscando",
    template: "%s · queandabuscando",
  },
  description: "Tiendas online para negocios cubanos.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // F-039 (architecture.md AD4): the boot script in src/features/currency/
    // reveal.ts writes `data-ref-currency` on THIS element before hydration.
    // Without this, React's dev-mode "Extra attributes from the server"
    // warning prints via `console.error`, which is exactly what turns a
    // green smoke/visual/probe stage red for a real, expected mismatch
    // (AGENTS.md § Cosas que muerden, ficha
    // `console-error-dispara-guardian-servidor.md`). Decided: AP1(a).
    <html lang="es" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
