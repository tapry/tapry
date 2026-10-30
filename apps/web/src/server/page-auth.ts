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

/** True before the first account exists: the home page then offers to create the admin. */
export async function isFreshInstall(): Promise<boolean> {
  const { db } = await getServices();
  const [{ exists }] = (await db.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM users) AS exists")) as [
    { exists: boolean },
  ];
  return !exists;
}
