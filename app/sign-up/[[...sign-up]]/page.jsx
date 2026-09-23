import { SignUp } from "@clerk/nextjs";

export const metadata = { title: "Registrati — Preventivo Fotovoltaico" };

export default function SignUpPage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <SignUp />
    </div>
  );
}
