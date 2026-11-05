import { redirect } from "next/navigation";

// Studios were called shows for a while; keep old links working.
export default function ShowsRedirect() {
  redirect("/studios");
}
