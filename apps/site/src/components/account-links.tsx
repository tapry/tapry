// Links that depend on whether the visitor is signed in to the hosted app. The pages are static,
// so both versions are in the HTML and CSS shows one: `html[data-signed-in]` is set before the
// first paint from the answer remembered in this browser, then corrected by asking the app
// (SIGNED_IN_SCRIPT, in the layout). Without a hosted app there is one link and nothing to ask.
import type { CSSProperties, ReactNode } from "react";
import { APP_URL, GET_STARTED, HAS_CLOUD, STUDIO_URL } from "@/content/site";

/**
 * Runs in <body> before the page: no flash of "Log in" for someone signed in. The app answers
 * only yes or no (GET /api/auth/status, readable by this site alone); the answer is kept in
 * localStorage so the next page starts right. Blocked storage or a failed request: signed out.
 */
export const SIGNED_IN_SCRIPT = HAS_CLOUD
  ? `(function(){var d=document.documentElement,k="tapry:signed-in";function set(v){d.toggleAttribute("data-signed-in",v)}try{set(localStorage.getItem(k)==="1")}catch(e){}fetch(${JSON.stringify(`${APP_URL}/api/auth/status`)},{credentials:"include"}).then(function(r){return r.ok?r.json():null}).then(function(j){if(!j)return;set(j.signedIn===true);try{localStorage.setItem(k,j.signedIn===true?"1":"0")}catch(e){}}).catch(function(){})})()`
  : null;

/** "Get Started" for visitors, "Open Studio" for someone signed in: same look, one shown. */
export function StartLink({ className, style, children = "Get Started", onClick }: { className?: string; style?: CSSProperties; children?: ReactNode; onClick?: () => void }) {
  if (!HAS_CLOUD) {
    return (
      <a href={GET_STARTED} className={className} style={style} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <>
      <a href={GET_STARTED} className={`when-out ${className ?? ""}`} style={style} onClick={onClick} data-start="signup">
        {children}
      </a>
      <a href={STUDIO_URL} className={`when-in ${className ?? ""}`} style={style} onClick={onClick} data-start="studio">
        Open Studio
      </a>
    </>
  );
}
