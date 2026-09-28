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
// Referente/cellulare/email si inseriscono nello step "Consumi e spesa"
// della dashboard (o, se lasciati vuoti lì, quando si genera il CSV
// Noleggio) e si salvano col progetto: qui li leggiamo da `dati` invece di
// richiederli di nuovo. Se un progetto più vecchio non li ha (salvato prima
// di questo campo) o sono stati lasciati vuoti, la riga viene comunque
// inviata con quelle colonne vuote, senza bloccare l'operazione.
export async function POST(req, { params }) {
  const ctx = await requireAuthorizedUser();
  if (ctx.error) return ctx.error;

  const { id } = await params;

  const { data: p, error } = await supabaseAdmin()
    .from("progetti")
    .select("created_at, ragione_sociale, comune, provincia, impianto_proposto_kwp, accumulo_proposto_kwh, costo_impianto_proposto, dati")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!p) return NextResponse.json({ error: "Progetto non trovato." }, { status: 404 });

  const referente = p.dati?.referente || "";
  const cellulare = p.dati?.cellulare || "";
  const email = p.dati?.email || "";

  // Formato italiano gg/mm/aaaa, sempre a due cifre e nel fuso orario
  // italiano: new Date(...).toLocaleDateString("it-IT") lascia giorno/mese
  // senza lo zero iniziale (es. "5/9/2026" invece di "05/09/2026"), che
  // Google Sheets può interpretare o visualizzare in modo incoerente con le
  // altre date del foglio (già in formato gg/mm/aaaa a due cifre).
  const dataInvio = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(p.created_at));
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
    // Indice 13 = colonna N = VALORE OFF: la mandiamo come numero (non una
    // stringa "€ ...", che romperebbe eventuali somme/formule sulla
    // colonna) e chiediamo di formattarla come valuta subito dopo l'append,
    // così in foglio appare "€ 15.000,00" invece di "15000".
    await appendPipeRow(row, { currencyColumnIndexes: [13] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
