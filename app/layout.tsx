import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { siteConfig } from "@/lib/site";
import { themeInitScript } from "@/lib/theme";
import { personJsonLdString } from "@/lib/structured-data";
import { AuthProvider } from "@/components/ui/AuthProvider";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

// IBM Plex Mono over Space Mono: real 500 for the eyebrow weight (Space Mono
// synthesized it) and a narrower, more open letterform at 10-13px.
const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-mono-face",
  display: "swap",
});

const BASE_URL = "https://www.pisotskyiv.dev";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    // Home title carries the formal first name for name-search; subpages keep
    // the short suffix so titles stay clean.
    default: `${siteConfig.seoName} — ${siteConfig.title}`,
    template: `%s — ${siteConfig.name}`,
  },
  description: siteConfig.metaDescription,
  alternates: { canonical: "/" },
  authors: [{ name: siteConfig.seoName }],
  // Public Search Console token (not a secret — rendered into page HTML).
  verification: { google: "_nKuqgYjQTkCRDiAfPTabFgOIhKquW7IaZ8xh_otsrs" },
  openGraph: {
    title: `${siteConfig.seoName} — ${siteConfig.title}`,
    description: siteConfig.metaDescription,
    type: "website",
    url: BASE_URL,
    siteName: siteConfig.name,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.seoName} — ${siteConfig.title}`,
    description: siteConfig.metaDescription,
  },
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: personJsonLdString() }}
        />
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-text"
        >
          Skip to content
        </a>
        <AuthProvider>{children}</AuthProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
