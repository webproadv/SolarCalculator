import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { isEmailAuthorized } from "./supabaseAdmin";

// Verifica (server-side, per le API route che generano documenti) che
// l'utente sia autenticato con Clerk e presente nella whitelist email.
// Restituisce { error: NextResponse } oppure { userId, email }.
export async function requireAuthorizedUser() {
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
