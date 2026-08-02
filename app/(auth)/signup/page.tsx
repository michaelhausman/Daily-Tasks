import { redirect } from "next/navigation";

import { signUp } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/session";
import { AuthForm } from "../AuthForm";

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/");
  return <AuthForm mode="signup" action={signUp} />;
}
