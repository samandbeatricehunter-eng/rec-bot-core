import { useState } from "react";
import { isIosDevice, isStandalone, usePwaInstall } from "../lib/pwa-install.js";

// "Set Up Mobile App" — one button, three outcomes depending on the browser:
// - Chrome/Edge/Android (supports beforeinstallprompt): triggers the native install dialog.
// - iOS Safari (no such API exists): expands step-by-step "Add to Home Screen" instructions.
// - Anything else (desktop Firefox, in-app browsers, etc.): a fallback hint.
export function MobileAppSetup() {
  const { canInstall, promptInstall } = usePwaInstall();
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const alreadyInstalled = isStandalone();
  const ios = isIosDevice();

  async function handleClick() {
    setStatus(null);
    if (canInstall) {
      const outcome = await promptInstall();
      if (outcome === "accepted") setStatus("Installed — check your home screen.");
      else if (outcome === "dismissed") setStatus("Install dismissed.");
      return;
    }
    if (ios) {
      setShowIosSteps((open) => !open);
      return;
    }
    setStatus('Your browser doesn\'t support one-tap install — look for "Install app" or "Add to Home Screen" in its menu.');
  }

  if (alreadyInstalled) {
    return (
      <div className="site-billing-panel">
        <h2>Mobile App</h2>
        <p className="site-muted">You're using the installed app already — nice.</p>
      </div>
    );
  }

  return (
    <div className="site-billing-panel">
      <h2>Mobile App</h2>
      <p className="site-muted">
        Install REC League on your home screen for quick, full-screen access — no app store needed.
      </p>
      <div className="site-profile-actions">
        <button type="button" className="site-btn site-btn-primary" onClick={() => void handleClick()}>
          Set Up Mobile App
        </button>
      </div>
      {status && <p className="site-muted">{status}</p>}
      {showIosSteps && (
        <>
          <p className="site-muted">iOS only supports this from Safari — open this page there first if you're in another app or browser.</p>
          <ol className="site-ios-install-steps">
            <li>Tap the <strong>Share</strong> button (square with an arrow pointing up) in Safari's toolbar.</li>
            <li>Scroll down the share sheet and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong> in the top-right corner.</li>
          </ol>
        </>
      )}
    </div>
  );
}
