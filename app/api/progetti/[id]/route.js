import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { supabaseAdmin, isEmailAuthorized } from "../../../../lib/supabaseAdmin";

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

// Recupera un progetto salvato per intero (usato dalla home per
// ripristinare la dashboard: vedi /?progetto=<id>).
export async function GET(req, { params }) {
  const ctx = await requireAuthorizedUser();
  if (ctx.error) return ctx.error;

  const { id } = await params;
  const { data, error } = await supabaseAdmin().from("progetti").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Progetto non trovato." }, { status: 404 });
  return NextResponse.json(data);
}

// Aggiorna in-place un progetto già salvato (stessa riga, stesso id): usato
// da "Aggiorna progetto" in dashboard quando si riapre un preventivo
// esistente e si cambiano i valori proposti (es. il cliente vuole un
// impianto diverso), senza dover rifare da capo tutto il percorso guidato
// né creare una nuova riga. Per tenere comunque uno storico esplicito delle
// revisioni quando serve, la dashboard offre anche "Salva come nuova
// revisione", che continua a usare la POST su /api/progetti (nuova riga).
export async function PUT(req, { params }) {
  const ctx = await requireAuthorizedUser();
  if (ctx.error) return ctx.error;

  const { id } = await params;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo della richiesta non valido." }, { status: 400 });
  }

  const {
    company,
    quote,
    monthly,
    bollettaMode,
    ocrMonthlyKwh,
    potenzaDisponibile,
    fornitore,
    referente,
    cellulare,
    email,
    impiantoProposto,
    accumuloProposto,
    costoImpiantoProposto,
    numeroRateNoleggio,
    roofImages,
    nomeProgetto,
  } = body || {};
  if (!company || !quote) {
    return NextResponse.json({ error: "Dati mancanti: azienda e preventivo sono obbligatori." }, { status: 400 });
  }

  const row = {
    updated_at: new Date().toISOString(),
    // Non tocchiamo creato_da_email/creato_da_clerk_user_id: l'autore
    // originale del progetto resta quello, anche se ad aggiornarlo è un
    // collega.
    nome_progetto: nomeProgetto || company.ragioneSociale || null,
    piva: company.piva || null,
    ragione_sociale: company.ragioneSociale || null,
    comune: company.comune || null,
    provincia: company.provincia || null,
    impianto_proposto_kwp: Number(impiantoProposto) || null,
    accumulo_proposto_kwh: Number(accumuloProposto) || null,
    costo_impianto_proposto: Number(costoImpiantoProposto) || null,
    dati: { company, quote, monthly, bollettaMode, ocrMonthlyKwh, potenzaDisponibile, fornitore, referente, cellulare, email, impiantoProposto, accumuloProposto, costoImpiantoProposto, numeroRateNoleggio, roofImages },
  };

  const { data, error } = await supabaseAdmin().from("progetti").update(row).eq("id", id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Progetto non trovato." }, { status: 404 });
  return NextResponse.json({ id: data.id });
}

// Elimina un progetto salvato (facoltativo, per correggere un salvataggio
// sbagliato dalla lista "I miei progetti").
export async function DELETE(req, { params }) {
  const ctx = await requireAuthorizedUser();
  if (ctx.error) return ctx.error;

  const { id } = await params;
  const { error } = await supabaseAdmin().from("progetti").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
