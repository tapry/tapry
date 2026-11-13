import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./api";
import type { User } from "./auth";
import { getServices } from "./context";

/** The signed-in host for a server component, or null. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return (await getServices()).auth.userForToken(token);
}

/** Like currentUser, but sends anonymous visitors to the sign-in page. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Where to go after signing in, from a `next` query value: only a path on this server
 * ("/checkout/creator"), never another site. Anything else is ignored.
 */
export function safeNext(next: string | string[] | undefined): string | null {
  const v = Array.isArray(next) ? next[0] : next;
  return v && /^\/[A-Za-z0-9_\-./?=&%]*$/.test(v) && !v.startsWith("//") ? v : null;
}

/** True before the first account exists: the home page then offers to create the admin. */
export async function isFreshInstall(): Promise<boolean> {
  const { db } = await getServices();
  const [{ exists }] = (await db.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM users) AS exists")) as [
    { exists: boolean },
  ];
  return !exists;
}
