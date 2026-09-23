import { createClient } from "@supabase/supabase-js";

// Client Supabase lato server con la service role key: bypassa la Row
// Level Security ed è pensato per essere usato SOLO dentro le API route
// (app/api/...), mai importato in un componente client — le credenziali
// non arrivano mai al browser. La cache del client evita di ricrearlo ad
// ogni chiamata nello stesso processo serverless.
let cachedClient = null;

export function supabaseAdmin() {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase non configurato: mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY tra le variabili d'ambiente.");
  }
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

// Verifica se un'email è nella whitelist `authorized_emails`. Usata dalle
// API route come seconda verifica (oltre al middleware, che gira su Edge
// Runtime con la sua stessa logica via fetch — vedi middleware.js).
export async function isEmailAuthorized(email) {
  if (!email) return false;
  const { data, error } = await supabaseAdmin()
    .from("authorized_emails")
    .select("email")
    .ilike("email", email)
    .maybeSingle();
  if (error) {
    console.error("Errore verifica whitelist authorized_emails:", error.message);
    return false;
  }
  return Boolean(data);
}
