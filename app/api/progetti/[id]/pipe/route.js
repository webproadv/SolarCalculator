import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { supabaseAdmin, isEmailAuthorized } from "../../../../../lib/supabaseAdmin";
import { appendPipeRow } from "../../../../../lib/googleSheets";
import { regioneFromProvincia } from "../../../../../lib/provinceRegioni";

async function requireAuthorizedUser() {
  const { userId } = await auth();
  if (!userId) {
    return { error: NextResponse.json({ error: "Non autenticato." }, { status: 401 }) };
  }
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const email = user.primaryEmailAddress?.emailAddress || "";
  if (!(await isEmailAuthorized(email))) {
    return { error: NextResponse.json({ error: "Utente non autorizzato." }, { status: 403 }) };
  }
  return { userId, email };
}

// "Pipe": invia un progetto salvato come nuovo lead nel foglio Google Sheet
// condiviso del team ("Pipe FTV", foglio "PIPE") — sempre un append, non
// tocca mai le righe già presenti (vedi lib/googleSheets.js).
//
// Referente/cellulare/email non sono colonne della tabella `progetti` (non
// servono al resto del preventivo): vengono chiesti al volo nel modale
// "Pipe" della lista progetti, esattamente come già accade per il modale
// "Prepara Alaska" in dashboard.
export async function POST(req, { params }) {
  const ctx = await requireAuthorizedUser();
  if (ctx.error) return ctx.error;

  const { id } = await params;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo della richiesta non valido." }, { status: 400 });
  }

  const { referente, cellulare, email } = body || {};
  if (!referente?.trim() || !cellulare?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "Referente, cellulare ed email sono obbligatori." }, { status: 400 });
  }

  const { data: p, error } = await supabaseAdmin()
    .from("progetti")
    .select("created_at, ragione_sociale, comune, provincia, impianto_proposto_kwp, accumulo_proposto_kwh, costo_impianto_proposto")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!p) return NextResponse.json({ error: "Progetto non trovato." }, { status: 404 });

  const dataInvio = new Date(p.created_at).toLocaleDateString("it-IT");
  const haAccumulo = Number(p.accumulo_proposto_kwh) > 0;

  // Colonne nell'ordine esatto del foglio "PIPE":
  // NUM LEAD, AZIENDA, REFERENTE, CELLULARE, EMAIL, CANALE, DATA INVIO,
  // CITTA, REGIONE, STATO TRATT, PRODOTTO, POT KWP, POT ACC, VALORE OFF,
  // PAGAM, % CHIUSURA, NOTE.
  const row = [
    "",
    p.ragione_sociale || "",
    referente.trim(),
    cellulare.trim(),
    email.trim(),
    "",
    dataInvio,
    p.comune || "",
    regioneFromProvincia(p.provincia),
    "In Negoziazione",
    haAccumulo ? "FTV+ACC" : "FTV",
    p.impianto_proposto_kwp ?? "",
    p.accumulo_proposto_kwh ?? "",
    p.costo_impianto_proposto ?? "",
    "",
    "",
    "",
  ];

  try {
    await appendPipeRow(row);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
