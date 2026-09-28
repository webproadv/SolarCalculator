// Integrazione con Google Sheets (REST API v4) per il bottone "Pipe" nella
// lista progetti: ogni clic aggiunge in fondo al foglio lead del team una
// riga con i dati del preventivo — sempre in append, mai una riscrittura del
// file (vedi spreadsheets.values.append più sotto), così non c'è rischio di
// sovrascrivere righe inserite da altri nel frattempo.
//
// Autenticazione via Service Account Google (JWT firmato con RSA-SHA256,
// scambiato per un access token OAuth2) — nessuna dipendenza esterna
// (`googleapis`/`google-auth-library`): bastano `fetch` e il modulo `crypto`
// di Node, già disponibili.
//
// Richiede tre variabili d'ambiente (vedi README):
//   - GOOGLE_SHEETS_CLIENT_EMAIL: email del service account
//   - GOOGLE_SHEETS_PRIVATE_KEY: chiave privata del service account (PEM;
//     se incollata in un .env su una riga sola con "\n" letterali, qui
//     vengono convertiti in veri a capo)
//   - GOOGLE_SHEETS_PIPE_SPREADSHEET_ID: ID del file Google Sheet (dalla URL,
//     https://docs.google.com/spreadsheets/d/<ID>/edit...)
// Il foglio va condiviso con l'email del service account con permesso
// "Editor", altrimenti l'append fallisce con un errore di permessi.
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_SHEET_NAME = "PIPE";

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken() {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (!clientEmail || !privateKeyRaw) {
    throw new Error(
      "Integrazione Google Sheets non configurata (mancano GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY)."
    );
  }
  const privateKey = privateKeyRaw.includes("\\n") ? privateKeyRaw.replace(/\\n/g, "\n") : privateKeyRaw;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: clientEmail,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;

  const { createSign } = await import("crypto");
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(privateKey)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${unsigned}.${signature}`;

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Autenticazione Google Sheets fallita: ${data.error_description || data.error || r.status}`);
  }
  return data.access_token;
}

// Aggiunge una riga in fondo al foglio "PIPE": usa spreadsheets.values.append
// (INSERT_ROWS), che individua da sé la prima riga libera dopo l'ultima con
// dati nell'intervallo indicato — qui non serve quindi sapere a priori
// quante righe esistano già.
export async function appendPipeRow(values) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_PIPE_SPREADSHEET_ID;
  const sheetName = process.env.GOOGLE_SHEETS_PIPE_SHEET_NAME || DEFAULT_SHEET_NAME;
  if (!spreadsheetId) {
    throw new Error("Integrazione Google Sheets non configurata (manca GOOGLE_SHEETS_PIPE_SPREADSHEET_ID).");
  }

  const accessToken = await getAccessToken();
  const range = encodeURIComponent(`${sheetName}!A1:Q1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ values: [values] }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Scrittura su Google Sheets fallita: ${data.error?.message || r.status}`);
  }
  return data;
}
