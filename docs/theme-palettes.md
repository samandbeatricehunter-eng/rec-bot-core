# League Theme Palettes

Authoritative color + typography system for the web hub. Each **league type** gets its
own presentation theme, applied by setting `data-game-theme` on `<html>` (see
`apps/web/src/main.tsx` for the pre-hydration default and
`apps/web/src/components/shell/AppShell.tsx` for the league-driven value).

## How theming works

- **Shared components consume neutral tokens** (`--bg`, `--surface`, `--accent`,
  `--text-primary`, …) defined in `apps/web/src/styles/tokens.css`. No component
  hard-codes a palette color.
- `:root` holds the **CFB Victory Gold** palette as the base. Theme files only override
  what differs:
  - `apps/web/src/styles/themes/cfb27.css` → `[data-game-theme="cfb_27"]`
  - `apps/web/src/styles/themes/madden27.css` → `[data-game-theme="madden_26"]`,
    `[data-game-theme="madden_27"]`
- Legacy `--gold` / `--gold-light` / `--gold-dark` tokens are aliased to the accent trio,
  so existing screens recolor automatically without a rename.

**Theme identifier → palette map**

| `data-game-theme`         | Palette             |
| ------------------------- | ------------------- |
| `cfb_27`                  | CFB — Victory Gold  |
| `madden_26`, `madden_27`  | Madden — REC Platinum |

### Rules

- Gold and platinum are **accents**, not large background fills.
- **Team primary colors** apply only to their matchup-card sides — never to page chrome.
- No secondary team colors and no team logos.
- The matchup-card center is a light medallion (`#f2eee3`) with **dark** text.

---

## CFB — Victory Gold

Championship trophies, historic programs, stadium lights, printed game programs, warm
metallic detail. Traditional Saturday football. Display face: **REC Victory Slab**.

| Token                | Hex       | Use                                   |
| -------------------- | --------- | ------------------------------------- |
| `--bg`               | `#080A0C` | Main app background                   |
| `--surface`          | `#12161A` | Cards, navigation, modals             |
| `--surface-raised`   | `#1A1F24` | Elevated panels / selected cards      |
| `--accent`           | `#C99A2E` | Primary accent (gold)                 |
| `--accent-bright`    | `#F0C85A` | Active tabs, highlights, focus        |
| `--accent-dark`      | `#765616` | Pressed states, dark borders          |
| `--text-primary`     | `#F2EEE3` | Primary text                          |
| `--text-secondary`   | `#9C978B` | Secondary labels                      |
| `--border`           | `#3A3120` | Standard borders                      |
| `--border-strong`    | `#6A5120` | Featured card borders                 |
| `--success`          | `#4EA56A` | Confirmed / completed / winning       |
| `--warning`          | `#D99B32` | Pending / deadline                    |
| `--error` / `--danger` | `#C64A43` | Errors / rejected                    |

Gradients:

- `--accent-gradient`: `linear-gradient(180deg, #F0C85A 0%, #C99A2E 52%, #765616 100%)`
- `--panel-gradient`: `linear-gradient(145deg, #1A1F24 0%, #101317 58%, #080A0C 100%)`
- `--feature-gradient`: `radial-gradient(circle at 50% 0%, rgba(240,200,90,.15), transparent 52%)`

---

## Madden — REC Platinum

Professional football, front-office operations, polished broadcast graphics, brushed
metal, premium franchise management. Cooler and more industrial than CFB. Display face:
**REC Gridiron** (wider, squared, slight forward lean).

| Token                | Hex       | Use                                   |
| -------------------- | --------- | ------------------------------------- |
| `--bg`               | `#070809` | Main app background                   |
| `--surface`          | `#141619` | Cards, navigation, modals             |
| `--surface-raised`   | `#1D2024` | Elevated panels                       |
| `--accent`           | `#B8BDC4` | Primary accent (platinum)             |
| `--accent-bright`    | `#E1E4E8` | Highlights, active states             |
| `--accent-dark`      | `#737A82` | Steel — secondary metallic / pressed  |
| `--accent-secondary` | `#D7A52A` | Premium / championship gold accent    |
| `--text-primary`     | `#F4F5F6` | Primary text                          |
| `--text-secondary`   | `#949AA1` | Secondary text                        |
| `--border`           | `#353A40` | Standard border                       |
| `--border-strong`    | `#626971` | Elevated border                       |
| `--success`          | `#45A46B` | Successful states                     |
| `--warning`          | `#D59A35` | Pending states                        |
| `--error` / `--danger` | `#C7484B` | Errors / rejected                    |

Gradients:

- `--accent-gradient`: `linear-gradient(180deg, #E1E4E8 0%, #B8BDC4 46%, #737A82 100%)`
- `--panel-gradient`: `linear-gradient(145deg, #202328 0%, #121417 58%, #070809 100%)`
- `--metal-line`: `linear-gradient(90deg, transparent, rgba(184,189,196,.75), transparent)`

---

## Known follow-ups

- Baked raster art (highlight-broadcast chassis, badge textures, nav dial) is drawn in
  CFB gold and does **not** recolor for Madden — it is fixed artwork, not token-driven.
  Recoloring those assets for REC Platinum is a separate art task.
- Commissioner custom-team color editor is still pending (see
  [pending-product-work.md](pending-product-work.md)).
