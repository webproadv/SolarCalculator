import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep-alive di Supabase (piano Free): il progetto va in pausa dopo 7 giorni
// senza attività. Vercel Cron (vedi vercel.json) chiama questa rotta ogni 3
// giorni e qui si esegue una vera query sul database, che conta come attività.
//
// Sicurezza: la rotta è esclusa dal login Clerk (vedi proxy.js) ma si
// autentica da sola. Vercel, se nel progetto esiste la variabile d'ambiente
// CRON_SECRET, invia "Authorization: Bearer <CRON_SECRET>" a ogni chiamata
// del cron. Senza CRON_SECRET configurata la rotta rifiuta tutto (fail-closed).
// La risposta non contiene dati dell'archivio, solo conteggi.
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorizzato." }, { status: 401 });
  }

  try {
    const db = supabaseAdmin();
    // Due query leggere (solo conteggio, nessuna riga restituita).
    const [progetti, whitelist] = await Promise.all([
      db.from("progetti").select("id", { count: "exact", head: true }),
      db.from("authorized_emails").select("email", { count: "exact", head: true }),
    ]);
    const errore = progetti.error || whitelist.error;
    if (errore) throw new Error(errore.message);
    return NextResponse.json({
      ok: true,
      quando: new Date().toISOString(),
      progetti: progetti.count,
      utentiAutorizzati: whitelist.count,
    });
  } catch (err) {
    console.error("Keep-alive Supabase fallito:", err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
