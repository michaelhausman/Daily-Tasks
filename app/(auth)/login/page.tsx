import { redirect } from "next/navigation";

import { logIn } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/session";
import { AuthForm } from "../AuthForm";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return <AuthForm mode="login" action={logIn} />;
}
