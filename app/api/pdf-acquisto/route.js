import { NextResponse } from "next/server";
import { requireAuthorizedUser } from "../../../lib/authz";
import { fillPdfTemplate } from "../../../lib/pdfOtter";

// Template PDF Otter della proposta di acquisto diretto. Sovrascrivibile con
// PDFOTTER_TEMPLATE_ID_ACQUISTO (stessa PDFOTTER_API_KEY del PDF Noleggio).
const TEMPLATE_ACQUISTO_DEFAULT = "tem_BV8fHsaWJvx5B7";

// "PDF Acquisto": riempie il template PDF Otter della proposta di acquisto
// con i campi ricevuti dal client (vedi buildAcquistoFieldMap in
// app/page.jsx) e restituisce il PDF compilato pronto da scaricare.
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
    const templateId = process.env.PDFOTTER_TEMPLATE_ID_ACQUISTO || TEMPLATE_ACQUISTO_DEFAULT;
    const pdfBuffer = await fillPdfTemplate(fields, templateId);
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="acquisto.pdf"',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
