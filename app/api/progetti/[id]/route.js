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
