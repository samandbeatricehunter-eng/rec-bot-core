# @rec/web — Hub UI component source

Not a deployable app. This package holds the source for the hub route components (Hub
home, Roster, Matchups, League Mgmt, etc.), shared React contexts (auth, hub chrome,
league theme, chat drawer), and the CSS these components use. `packages/hub-ui`
re-exports these files directly (no build step) so `apps/site` — the only deployed
surface (PWA + website) — can mount them with its own shell, nav, and auth.

There used to be a second, standalone entry point here (`App.tsx`/`main.tsx`, a
Discord-Activity-style iframe shell reached via a `?token=` JWT link) that was deployed
as its own Railway service. That's been removed — Discord's `/app` command now opens a
site deep-link instead. If you're looking for chrome/navigation, see
`apps/site/src/components/LeagueTopNav.tsx` and `SiteShell.tsx`.

## Local development

There's no dev server for this package on its own — preview changes through `apps/site`
(`pnpm --filter @rec/site dev`), which imports these components live.

`pnpm --filter @rec/web typecheck` runs `tsc --noEmit` over the source.
