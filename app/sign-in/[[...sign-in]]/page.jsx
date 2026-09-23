import { SignIn } from "@clerk/nextjs";

export const metadata = { title: "Accedi — Preventivo Fotovoltaico" };

export default function SignInPage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <SignIn />
    </div>
  );
}
