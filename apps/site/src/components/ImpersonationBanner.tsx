import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { endImpersonation, impersonationTargetName, isImpersonating } from "../lib/impersonation.js";

export function ImpersonationBanner() {
  const [active, setActive] = useState(() => isImpersonating());
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  if (!active) return null;

  return (
    <div className="site-impersonation-banner" role="status">
      <span>
        Viewing as <strong>{impersonationTargetName() ?? "this user"}</strong>
      </span>
      <button
        type="button"
        className="site-btn site-btn-ghost"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void endImpersonation()
            .then(() => {
              setActive(false);
              navigate("/admin");
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Returning…" : "Return to admin account"}
      </button>
    </div>
  );
}
