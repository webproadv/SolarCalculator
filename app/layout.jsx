import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { itIT } from "@clerk/localizations";

export const metadata = {
  title: "Preventivo Fotovoltaico",
  description: "Dimensionamento e preventivo automatico di impianti fotovoltaici da Partita IVA e bolletta.",
};

// L'intera app è protetta da Clerk (vedi middleware.js): solo chi accede
// con un account autenticato E la cui email è nella whitelist Supabase
// "authorized_emails" può usarla. ClerkProvider va attorno a tutto perché
// serve sia alle pagine protette sia a /sign-in, /sign-up e /non-autorizzato.
export default function RootLayout({ children }) {
  return (
    <ClerkProvider localization={itIT}>
      <html lang="it">
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
          <link
            href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
            rel="stylesheet"
          />
        </head>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
