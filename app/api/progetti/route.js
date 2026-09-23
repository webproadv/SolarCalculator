import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { supabaseAdmin, isEmailAuthorized } from "../../../lib/supabaseAdmin";

// Il middleware già blocca chi non è autenticato o non è in whitelist prima
// di arrivare qui; questa funzione è una seconda verifica (difesa in
// profondità) e recupera l'email dell'utente per attribuire il salvataggio.
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

// Elenco progetti salvati (tutti gli utenti autorizzati vedono lo stesso
// elenco condiviso: è uno strumento di lavoro interno, non multi-tenant).
export async function GET() {
  const ctx = await requireAuthorizedUser();
  if (ctx.error) return ctx.error;

  const { data, error } = await supabaseAdmin()
    .from("progetti")
    .select(
      "id, created_at, nome_progetto, piva, ragione_sociale, comune, provincia, impianto_proposto_kwp, accumulo_proposto_kwh, costo_impianto_proposto, creato_da_email"
    )
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ progetti: data });
}

// Salva un nuovo snapshot del progetto (ogni salvataggio crea una nuova
// riga: mantiene automaticamente uno storico delle revisioni per cliente,
// utile finché non serve un vero "aggiorna" esplicito).
export async function POST(req) {
  const ctx = await requireAuthorizedUser();
  if (ctx.error) return ctx.error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo della richiesta non valido." }, { status: 400 });
  }

  const { company, quote, monthly, bollettaMode, impiantoProposto, accumuloProposto, costoImpiantoProposto, nomeProgetto } = body || {};
  if (!company || !quote) {
    return NextResponse.json({ error: "Dati mancanti: azienda e preventivo sono obbligatori." }, { status: 400 });
  }

  const row = {
    creato_da_email: ctx.email,
    creato_da_clerk_user_id: ctx.userId,
    nome_progetto: nomeProgetto || company.ragioneSociale || null,
    piva: company.piva || null,
    ragione_sociale: company.ragioneSociale || null,
    comune: company.comune || null,
    provincia: company.provincia || null,
    impianto_proposto_kwp: Number(impiantoProposto) || null,
    accumulo_proposto_kwh: Number(accumuloProposto) || null,
    costo_impianto_proposto: Number(costoImpiantoProposto) || null,
    // Snapshot completo: tutto ciò che serve per ricostruire la dashboard
    // (e in futuro generare il PDF) senza dover richiamare le API esterne.
    dati: { company, quote, monthly, bollettaMode, impiantoProposto, accumuloProposto, costoImpiantoProposto },
  };

  const { data, error } = await supabaseAdmin().from("progetti").insert(row).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
