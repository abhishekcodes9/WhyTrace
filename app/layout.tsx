import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";
import { RepoProvider } from "@/components/repo-provider";
import { SiteHeader } from "@/components/site-header";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "WHYTRACE — Every Codebase Has a Story",
    template: "%s · WHYTRACE",
  },
  description:
    "Investigate your codebase. Follow its history. Discover why it exists. Evidence-backed engineering history investigations grounded in GitHub and Neo4j.",
  applicationName: "WHYTRACE",
  keywords: ["engineering history", "code archaeology", "Neo4j", "GraphRAG", "GitHub", "software architecture"],
};

export const viewport: Viewport = {
  themeColor: "#17120F",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cormorant.variable} ${inter.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh bg-surface text-on-surface antialiased">
        <RepoProvider>
          <div className="relative flex min-h-dvh flex-col">
            <SiteHeader />
            <div className="flex-1">{children}</div>
            <footer className="border-t border-outline-variant bg-surface-container-low px-4 py-5 md:px-page-margin">
              <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                <p className="font-mono text-mono-sm text-on-surface-variant">
                  WHYTRACE · Evidence before explanation. Uncertainty before assumption.
                </p>
                <p className="font-mono text-mono-sm text-on-surface-variant/70">
                  Neo4j · GitHub · Gemini
                </p>
              </div>
            </footer>
          </div>
        </RepoProvider>
      </body>
    </html>
  );
}
