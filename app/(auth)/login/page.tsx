import { redirect } from "next/navigation";

import { logIn } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/session";
import { AuthForm } from "../AuthForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getCurrentUser()) redirect("/");
  const { next } = await searchParams;
  return (
    <AuthForm
      mode="login"
      action={logIn}
      next={typeof next === "string" ? next : undefined}
    />
  );
}
