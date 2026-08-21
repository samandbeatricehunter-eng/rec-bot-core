import { useEffect, useMemo, useState } from "react";
import {
  maddenRelocationBrandsForCity,
  maddenRelocationLogoPath,
  type MaddenRelocationBrand,
  type MaddenRelocationCity,
} from "@rec/shared";
import { recApi } from "../../lib/rec-api-client.js";
import { Button } from "../ui/Button.js";
import { TeamLogo } from "../ui/TeamLogo.js";

type Catalog = {
  cities: Array<MaddenRelocationCity & { label: string }>;
  brands: Array<MaddenRelocationBrand & { logoUrl: string }>;
};

type Path = "relocate" | "custom" | null;

export function RelocateTeamWizard({
  guildId,
  onApplied,
}: {
  guildId: string;
  onApplied: (message: string) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<Path>(null);
  const [keepBranding, setKeepBranding] = useState<boolean | null>(null);
  const [cityId, setCityId] = useState("");
  const [brandSlug, setBrandSlug] = useState("");
  const [city, setCity] = useState("");
  const [nick, setNick] = useState("");
  const [abbr, setAbbr] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#C8102E");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    recApi.getRelocationCatalog(guildId)
      .then(setCatalog)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load relocation options."));
  }, [guildId]);

  const brands = useMemo(() => (cityId ? maddenRelocationBrandsForCity(cityId) : []), [cityId]);
  const selectedBrand = brands.find((brand) => brand.slug === brandSlug) ?? null;

  async function uploadLogo(file: File | null) {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const uploaded = await recApi.uploadHubTeamLogo(guildId, file);
      setLogoUrl(uploaded.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Logo upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRelocate() {
    if (!cityId) return setError("Pick a relocation city.");
    if (keepBranding === false && !brandSlug) return setError("Pick a relocation team brand.");
    setBusy(true); setError(null);
    try {
      await recApi.relocateHubTeam({
        guildId,
        cityId,
        keepBranding: Boolean(keepBranding),
        brandSlug: keepBranding ? null : brandSlug,
      });
      onApplied(keepBranding
        ? "Team city updated. Existing name and logo stay in place."
        : "Relocation applied across the site and Discord.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Relocation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCustom() {
    if (!city.trim() || !nick.trim() || !abbr.trim()) return setError("Enter a city, team name, and abbreviation.");
    if (!logoUrl) return setError("Upload a logo for commissioner approval.");
    setBusy(true); setError(null);
    try {
      await recApi.submitCustomTeamIdentity({ guildId, city, nick, abbr, primaryColor, logoUrl });
      onApplied("Custom team submitted. The logo is waiting on commissioner approval in Pending Items.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Custom team submit failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hub-relocate-wizard">
      {error && <p className="hub-transfer-status">{error}</p>}
      {!catalog && !error && <p className="hub-empty">Loading relocation options…</p>}

      {catalog && path === null && (
        <>
          <p className="hub-muted">Relocate this franchise in REC to match what you did in Madden, or submit a fully custom identity.</p>
          <div className="hub-relocate-choice-row">
            <button type="button" className="hub-relocate-choice" onClick={() => setPath("relocate")}>
              <strong>Relocation</strong>
              <span>Pick a Madden 27 city and an official relocation brand.</span>
            </button>
            <button type="button" className="hub-relocate-choice" onClick={() => setPath("custom")}>
              <strong>Custom team</strong>
              <span>Your city, name, logo, and color — logo needs commissioner approval.</span>
            </button>
          </div>
        </>
      )}

      {catalog && path === "relocate" && (
        <>
          <button type="button" className="hub-relocate-back" onClick={() => { setPath(null); setKeepBranding(null); setCityId(""); setBrandSlug(""); }}>Back</button>
          {keepBranding === null ? (
            <>
              <p className="hub-muted">Keep your current logo and nickname, or switch to a Madden relocation brand?</p>
              <div className="hub-relocate-choice-row">
                <button type="button" className="hub-relocate-choice" onClick={() => setKeepBranding(true)}>
                  <strong>Keep existing logo &amp; name</strong>
                  <span>Only the city/location changes.</span>
                </button>
                <button type="button" className="hub-relocate-choice" onClick={() => setKeepBranding(false)}>
                  <strong>Change logo &amp; name</strong>
                  <span>Pick a prebuilt Madden relocation team.</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="form-field">
                <span className="form-label">Relocation city</span>
                <select className="form-input" value={cityId} onChange={(event) => { setCityId(event.target.value); setBrandSlug(""); }}>
                  <option value="">Select a city</option>
                  {catalog.cities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              {!keepBranding && (
                <div className="hub-relocate-brand-grid">
                  {brands.map((brand) => (
                    <button
                      key={brand.slug}
                      type="button"
                      className={brandSlug === brand.slug ? "hub-relocate-brand is-active" : "hub-relocate-brand"}
                      onClick={() => setBrandSlug(brand.slug)}
                      style={{ "--brand-color": brand.primaryColor } as Record<string, string>}
                    >
                      <TeamLogo logoUrl={maddenRelocationLogoPath(brand.slug)} abbreviation={null} alt={brand.name} />
                      <strong>{brand.name}</strong>
                      <span>{brand.abbr}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedBrand && (
                <p className="hub-muted">Primary color {selectedBrand.primaryColor} · {selectedBrand.name}</p>
              )}
              <Button variant="primary" disabled={busy || !cityId || (!keepBranding && !brandSlug)} onClick={() => void submitRelocate()}>
                {busy ? "Saving…" : "Apply relocation"}
              </Button>
            </>
          )}
        </>
      )}

      {catalog && path === "custom" && (
        <>
          <button type="button" className="hub-relocate-back" onClick={() => setPath(null)}>Back</button>
          <label className="form-field"><span className="form-label">City</span><input className="form-input" value={city} onChange={(event) => setCity(event.target.value)} /></label>
          <label className="form-field"><span className="form-label">Team name</span><input className="form-input" value={nick} onChange={(event) => setNick(event.target.value)} /></label>
          <label className="form-field"><span className="form-label">Abbreviation</span><input className="form-input" maxLength={4} value={abbr} onChange={(event) => setAbbr(event.target.value.toUpperCase())} /></label>
          <label className="form-field">
            <span className="form-label">Primary color</span>
            <span className="hub-relocate-color-row">
              <input type="color" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value.toUpperCase())} />
              <input className="form-input" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value.toUpperCase())} />
            </span>
          </label>
          <label className="form-field">
            <span className="form-label">Logo</span>
            <input className="form-input" type="file" accept="image/png,image/webp" onChange={(event) => void uploadLogo(event.target.files?.[0] ?? null)} />
            {logoUrl && <img className="hub-relocate-logo-preview" src={logoUrl} alt="Custom team logo preview" />}
          </label>
          <p className="hub-muted">Use a square PNG or WebP crest with a <strong>transparent background</strong>. Solid backgrounds are rejected or look wrong on matchup cards. We’ll resize it to match the stock NFL logos (400×400). The commissioner must approve this logo in Pending Items before the identity goes live.</p>
          <Button variant="primary" disabled={busy || !city.trim() || !nick.trim() || !abbr.trim() || !logoUrl} onClick={() => void submitCustom()}>
            {busy ? "Submitting…" : "Submit for approval"}
          </Button>
        </>
      )}
    </div>
  );
}
