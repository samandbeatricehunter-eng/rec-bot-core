// Official NFL team primary colors (2024–25 season brand guides).
// Custom / relocated teams keep "#FFFFFF" until the commissioner sets a color.
export const NFL_TEAM_PRIMARY_COLORS: Readonly<Record<string, string>> = {
  // AFC East
  "BUF": "#00338D",
  "MIA": "#008E97",
  "NE":  "#002244",
  "NYJ": "#125740",
  // AFC North
  "BAL": "#241773",
  "CIN": "#FB4F14",
  "CLE": "#311D00",
  "PIT": "#FFB612",
  // AFC South
  "HOU": "#03202F",
  "IND": "#002C5F",
  "JAX": "#006778",
  "TEN": "#0C2340",
  // AFC West
  "DEN": "#FB4F14",
  "KC":  "#E31837",
  "LAC": "#0080C6",
  "LV":  "#A5ACAF",
  // NFC East
  "DAL": "#003594",
  "NYG": "#0B2265",
  "PHI": "#004C54",
  "WAS": "#773141",
  // NFC North
  "CHI": "#0B162A",
  "DET": "#0076B6",
  "GB":  "#203731",
  "MIN": "#4F2683",
  // NFC South
  "ATL": "#A71930",
  "CAR": "#0085CA",
  "NO":  "#D3BC8D",
  "TB":  "#D50A0A",
  // NFC West
  "ARI": "#97233F",
  "LAR": "#003594",
  "SF":  "#AA0000",
  "SEA": "#002244",
};

// Official NFL team secondary colors (2024-25 season brand guides) -- used alongside
// NFL_TEAM_PRIMARY_COLORS wherever a team needs a two-tone treatment (e.g. hero matchup card
// side panels). Custom / relocated teams have no entry until the commissioner sets one.
export const NFL_TEAM_SECONDARY_COLORS: Readonly<Record<string, string>> = {
  // AFC East
  "BUF": "#C60C30",
  "MIA": "#FC4C02",
  "NE":  "#C60C30",
  "NYJ": "#000000",
  // AFC North
  "BAL": "#000000",
  "CIN": "#000000",
  "CLE": "#FF3C00",
  "PIT": "#101820",
  // AFC South
  "HOU": "#A71930",
  "IND": "#A2AAAD",
  "JAX": "#D7A22A",
  "TEN": "#4B92DB",
  // AFC West
  "DEN": "#002244",
  "KC":  "#FFB612",
  "LAC": "#FFC20E",
  "LV":  "#000000",
  // NFC East
  "DAL": "#869397",
  "NYG": "#A71930",
  "PHI": "#A5ACAF",
  "WAS": "#FFB612",
  // NFC North
  "CHI": "#C83803",
  "DET": "#B0B7BC",
  "GB":  "#FFB612",
  "MIN": "#FFC62F",
  // NFC South
  "ATL": "#000000",
  "CAR": "#000000",
  "NO":  "#000000",
  "TB":  "#34302B",
  // NFC West
  "ARI": "#000000",
  "LAR": "#FFA300",
  "SF":  "#B3995D",
  "SEA": "#69BE28",
};
