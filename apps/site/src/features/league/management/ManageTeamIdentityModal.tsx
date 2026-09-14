import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { recApi } from "../../../../../web/src/lib/rec-api-client.js";
import type { TeamManagementSummaryRow } from "../../../../../web/src/types/api.js";
import { Modal } from "../../../../../web/src/components/ui/Modal.js";
import { Button } from "../../../../../web/src/components/ui/Button.js";
import { TeamLogo } from "../../../../../web/src/components/ui/TeamLogo.js";
import { resolveTeamAppearance } from "../../../../../web/src/components/team/index.js";

type FieldKey = "abbr" | "city" | "nick";

function LockedTextField({
  label,
  value,
  editing,
  onEdit,
  onChange,
  maxLength,
}: {
  label: string;
  value: string;
  editing: boolean;
  onEdit: () => void;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  return (
    <label className="form-field mgmt-team-identity-field">
      <span className="form-label">{label}</span>
      <span className="mgmt-team-identity-input-row">
        <input
          className="form-input"
          value={value}
          readOnly={!editing}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
        />
        {!editing ? (
          <button type="button" className="mgmt-team-identity-pencil" onClick={onEdit} aria-label={`Edit ${label}`}>
            <Pencil size={16} />
          </button>
        ) : null}
      </span>
    </label>
  );
}

export function ManageTeamIdentityModal({
  guildId,
  team,
  onClose,
  onSaved,
}: {
  guildId: string;
  team: TeamManagementSummaryRow;
  onClose: () => void;
  onSaved: (next: Partial<TeamManagementSummaryRow> & { id: string }) => void;
}) {
  const appearance = resolveTeamAppearance({
    abbreviation: team.abbreviation,
    displayAbbr: team.displayAbbr,
    originalAbbreviation: team.originalAbbreviation,
    primaryColor: team.primaryColor,
    logoUrl: team.logoUrl,
    displayCity: team.displayCity,
    displayNick: team.displayNick,
    name: team.name,
  });

  const [abbr, setAbbr] = useState((team.displayAbbr || team.abbreviation || "").toUpperCase());
  const [city, setCity] = useState(team.displayCity?.trim() || appearance.city);
  const [nick, setNick] = useState(team.displayNick?.trim() || appearance.nick);
  const [logoUrl, setLogoUrl] = useState<string | null>(team.logoUrl);
  const [editing, setEditing] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setAbbr((team.displayAbbr || team.abbreviation || "").toUpperCase());
    setCity(team.displayCity?.trim() || appearance.city);
    setNick(team.displayNick?.trim() || appearance.nick);
    setLogoUrl(team.logoUrl);
    setEditing({});
    setError(null);
  }, [team.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when switching teams

  async function onLogoPicked(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await recApi.uploadHubTeamLogo(guildId, file);
      setLogoUrl(uploaded.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Logo upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await recApi.updateTeamIdentityAsCommissioner({
        guildId,
        teamId: team.id,
        displayCity: city.trim(),
        displayNick: nick.trim(),
        displayAbbr: abbr.trim().toUpperCase(),
        logoUrl,
        keepStockLogo: !logoUrl,
      });
      onSaved({
        id: team.id,
        name: result.team.name,
        displayCity: result.team.displayCity,
        displayNick: result.team.displayNick,
        displayAbbr: result.team.displayAbbr,
        abbreviation: result.team.abbreviation,
        logoUrl: result.team.logoUrl,
        primaryColor: result.team.primaryColor,
        originalAbbreviation: result.team.originalAbbreviation,
        isRelocated: result.team.isRelocated,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save team identity.");
    } finally {
      setBusy(false);
    }
  }

  const previewAbbr = abbr.trim() || team.abbreviation;

  return (
    <Modal title="Edit Team" onClose={onClose} showClose={false} panelClassName="mgmt-team-identity-modal">
      <div className="mgmt-team-identity-body">
        <button
          type="button"
          className="mgmt-team-identity-logo"
          onClick={() => fileRef.current?.click()}
          disabled={busy || uploading}
          aria-label="Update team logo"
          title="Click to upload a new logo"
        >
          <TeamLogo
            abbreviation={previewAbbr}
            logoUrl={logoUrl}
            alt=""
            className="mgmt-team-identity-logo-img"
            priority
          />
          <span>{uploading ? "Uploading…" : "Change logo"}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/webp"
          hidden
          onChange={(event) => void onLogoPicked(event.target.files?.[0] ?? null)}
        />

        <LockedTextField
          label="Abbreviation"
          value={abbr}
          editing={Boolean(editing.abbr)}
          onEdit={() => setEditing((prev) => ({ ...prev, abbr: true }))}
          onChange={(value) => setAbbr(value.toUpperCase())}
          maxLength={4}
        />
        <LockedTextField
          label="City"
          value={city}
          editing={Boolean(editing.city)}
          onEdit={() => setEditing((prev) => ({ ...prev, city: true }))}
          onChange={setCity}
        />
        <LockedTextField
          label="Nickname"
          value={nick}
          editing={Boolean(editing.nick)}
          onEdit={() => setEditing((prev) => ({ ...prev, nick: true }))}
          onChange={setNick}
        />

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <div className="mgmt-team-identity-actions">
          <Button variant="secondary" disabled={busy || uploading} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || uploading || !city.trim() || !nick.trim() || abbr.trim().length < 2}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
