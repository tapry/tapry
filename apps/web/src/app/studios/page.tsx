import { redirect } from "next/navigation";

// Studios are called shows in the app now; keep old links working.
export default function StudiosRedirect() {
  redirect("/shows");
}
