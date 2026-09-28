import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { isEmailAuthorized } from "../../../lib/supabaseAdmin";
import { fillPdfTemplate } from "../../../lib/pdfOtter";

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

// "PDF Noleggio": riempie il template PDF Otter del contratto di noleggio
// operativo con i campi ricevuti dal client — la stessa mappatura usata per
// il CSV Noleggio (vedi buildAlaskaFieldMap in app/page.jsx: un campo del
// template PDF = una colonna del CSV) — e restituisce il PDF compilato
// pronto da scaricare.
export async function POST(req) {
  const ctx = await requireAuthorizedUser();
  if (ctx.error) return ctx.error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo della richiesta non valido." }, { status: 400 });
  }

  const { fields } = body || {};
  if (!fields || typeof fields !== "object") {
    return NextResponse.json({ error: "Campi mancanti." }, { status: 400 });
  }

  try {
    const pdfBuffer = await fillPdfTemplate(fields);
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="noleggio.pdf"',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
