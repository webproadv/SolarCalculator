import { clerkMiddleware, clerkClient, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Pagine raggiungibili senza essere autenticati: login, registrazione e la
// schermata di "accesso non autorizzato" (altrimenti un utente respinto
// da lì finirebbe in un loop di redirect).
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/non-autorizzato"]);

// Verifica la whitelist email direttamente via REST (fetch), invece di
// importare il client @supabase/supabase-js: il middleware gira su Edge
// Runtime e questo evita qualunque dipendenza da API Node non disponibili
// lì. Usa la service role key: mai esposta al browser, letta solo qui
// lato server. Nessuna riga trovata (o Supabase non configurato) => accesso
// negato per sicurezza (fail-closed).
async function isEmailAuthorized(email) {
  if (!email) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(
      `${url}/rest/v1/authorized_emails?email=ilike.${encodeURIComponent(email)}&select=email`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  // Non autenticato => Clerk reindirizza automaticamente al sign-in.
  const { userId } = await auth.protect();

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const email = user.primaryEmailAddress?.emailAddress || "";

  if (!(await isEmailAuthorized(email))) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Utente non autorizzato." }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/non-autorizzato", req.url));
  }
});

export const config = {
  matcher: [
    // Applica il middleware a tutto tranne i file statici di Next e le
    // risorse con estensione (immagini, css, ecc.).
    "/((?!_next|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|map)$).*)",
    "/(api|trpc)(.*)",
  ],
};
