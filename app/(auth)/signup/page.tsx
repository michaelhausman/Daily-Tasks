import Link from "next/link";
import { redirect } from "next/navigation";

import { signUp } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/session";
import { SIGNUP_INVITE_CODE, SIGNUP_OPEN } from "@/lib/config";
import { AuthForm } from "../AuthForm";

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/");

  if (!SIGNUP_OPEN) {
    return (
      <div className="surface mx-auto max-w-sm rounded-2xl p-8 text-center">
        <h1 className="mb-2 text-xl font-bold">Signups are closed</h1>
        <p className="mb-6 text-sm muted">
          Browsing is still open — have a look around.
        </p>
        <Link href="/explore" className="btn btn-primary">
          Explore moments
        </Link>
      </div>
    );
  }

  return (
    <AuthForm
      mode="signup"
      action={signUp}
      inviteRequired={SIGNUP_INVITE_CODE !== null}
    />
  );
}

export const dynamic = "force-dynamic";
