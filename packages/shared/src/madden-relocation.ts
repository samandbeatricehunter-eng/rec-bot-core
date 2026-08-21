/** Madden 27 franchise relocation catalog — cities and prebuilt team brands.
 *  Logos in this repo are original REC crests (not EA assets), colored to each
 *  brand's documented uniform primary. Oilers is Houston-only in-game. */

export type MaddenRelocationCity = {
  id: string;
  name: string;
  region: string | null;
};

export type MaddenRelocationBrand = {
  slug: string;
  name: string;
  abbr: string;
  primaryColor: string;
  secondaryColor: string;
  houstonOnly?: boolean;
};

export const MADDEN_RELOCATION_CITIES: readonly MaddenRelocationCity[] = [
  { id: "albuquerque", name: "Albuquerque", region: null },
  { id: "anchorage", name: "Anchorage", region: null },
  { id: "austin", name: "Austin", region: null },
  { id: "brooklyn", name: "Brooklyn", region: null },
  { id: "buenos-aires", name: "Buenos Aires", region: "Argentina" },
  { id: "canton", name: "Canton", region: null },
  { id: "chicago", name: "Chicago", region: null },
  { id: "columbus", name: "Columbus", region: null },
  { id: "dublin", name: "Dublin", region: "Ireland" },
  { id: "honolulu", name: "Honolulu", region: null },
  { id: "houston", name: "Houston", region: null },
  { id: "london", name: "London", region: "England" },
  { id: "louisville", name: "Louisville", region: null },
  { id: "melbourne", name: "Melbourne", region: "Australia" },
  { id: "memphis", name: "Memphis", region: null },
  { id: "mexico-city", name: "Mexico City", region: "Mexico" },
  { id: "montreal", name: "Montreal", region: "Canada" },
  { id: "oakland", name: "Oakland", region: null },
  { id: "oklahoma-city", name: "Oklahoma City", region: null },
  { id: "omaha", name: "Omaha", region: null },
  { id: "orlando", name: "Orlando", region: null },
  { id: "paris", name: "Paris", region: "France" },
  { id: "portland", name: "Portland", region: null },
  { id: "rio-de-janeiro", name: "Rio De Janeiro", region: "Brazil" },
  { id: "salt-lake-city", name: "Salt Lake City", region: null },
  { id: "san-antonio", name: "San Antonio", region: null },
  { id: "san-diego", name: "San Diego", region: null },
  { id: "san-juan", name: "San Juan", region: "Puerto Rico" },
  { id: "sacramento", name: "Sacramento", region: null },
  { id: "st-louis", name: "St. Louis", region: null },
  { id: "tokyo", name: "Tokyo", region: "Japan" },
  { id: "toronto", name: "Toronto", region: "Canada" },
  { id: "vancouver", name: "Vancouver", region: "Canada" },
  { id: "virginia-beach", name: "Virginia Beach", region: null },
];

export const MADDEN_RELOCATION_BRANDS: readonly MaddenRelocationBrand[] = [
  { slug: "antlers", name: "Antlers", abbr: "ANT", primaryColor: "#2E5A27", secondaryColor: "#6B3F1F" },
  { slug: "armadillos", name: "Armadillos", abbr: "ARM", primaryColor: "#C41E3A", secondaryColor: "#C9A227" },
  { slug: "aviators", name: "Aviators", abbr: "AVI", primaryColor: "#1A3A6B", secondaryColor: "#111111" },
  { slug: "bisons", name: "Bisons", abbr: "BIS", primaryColor: "#F5A623", secondaryColor: "#1E4D8C" },
  { slug: "black-knights", name: "Black Knights", abbr: "BKN", primaryColor: "#1A1A1A", secondaryColor: "#C8102E" },
  { slug: "blues", name: "Blues", abbr: "BLU", primaryColor: "#0033A0", secondaryColor: "#111111" },
  { slug: "bulls", name: "Bulls", abbr: "BUL", primaryColor: "#0B5ED7", secondaryColor: "#F5D76E" },
  { slug: "caps", name: "Caps", abbr: "CAP", primaryColor: "#C8102E", secondaryColor: "#0033A0" },
  { slug: "condors", name: "Condors", abbr: "CON", primaryColor: "#4B0082", secondaryColor: "#111111" },
  { slug: "desperados", name: "Desperados", abbr: "DES", primaryColor: "#8B0000", secondaryColor: "#2B2B2B" },
  { slug: "dragons", name: "Dragons", abbr: "DRG", primaryColor: "#B22222", secondaryColor: "#1A1A1A" },
  { slug: "dreadnoughts", name: "Dreadnoughts", abbr: "DRD", primaryColor: "#003366", secondaryColor: "#F5D76E" },
  { slug: "elks", name: "Elks", abbr: "ELK", primaryColor: "#1E4D8C", secondaryColor: "#F5D76E" },
  { slug: "golden-eagles", name: "Golden Eagles", abbr: "GEA", primaryColor: "#A31F34", secondaryColor: "#0B5A2A" },
  { slug: "huskies", name: "Huskies", abbr: "HUS", primaryColor: "#002868", secondaryColor: "#111111" },
  { slug: "lumberjacks", name: "Lumberjacks", abbr: "LUM", primaryColor: "#9B1B30", secondaryColor: "#1A1A1A" },
  { slug: "monarchs", name: "Monarchs", abbr: "MON", primaryColor: "#BF0A30", secondaryColor: "#0033A0" },
  { slug: "mounties", name: "Mounties", abbr: "MNT", primaryColor: "#1C3F94", secondaryColor: "#C9A227" },
  { slug: "night-hawks", name: "Night Hawks", abbr: "NHW", primaryColor: "#3D1A5B", secondaryColor: "#111111" },
  { slug: "oilers", name: "Oilers", abbr: "OIL", primaryColor: "#C8102E", secondaryColor: "#0033A0", houstonOnly: true },
  { slug: "orbits", name: "Orbits", abbr: "ORB", primaryColor: "#4A90A4", secondaryColor: "#6B7280" },
  { slug: "pioneers", name: "Pioneers", abbr: "PIO", primaryColor: "#8B4513", secondaryColor: "#E07A28" },
  { slug: "redwoods", name: "Redwoods", abbr: "RED", primaryColor: "#0B3D0B", secondaryColor: "#6B3F1F" },
  { slug: "river-hogs", name: "River Hogs", abbr: "RHG", primaryColor: "#1560BD", secondaryColor: "#F4F5F6" },
  { slug: "sentinels", name: "Sentinels", abbr: "SEN", primaryColor: "#2C3E50", secondaryColor: "#6B7280" },
  { slug: "shamrocks", name: "Shamrocks", abbr: "SHA", primaryColor: "#006A4E", secondaryColor: "#F4F5F6" },
  { slug: "snowhawks", name: "Snowhawks", abbr: "SNW", primaryColor: "#5B7C99", secondaryColor: "#E8EEF4" },
  { slug: "steamers", name: "Steamers", abbr: "STM", primaryColor: "#2B2B2B", secondaryColor: "#C8102E" },
  { slug: "thunderbirds", name: "Thunderbirds", abbr: "THU", primaryColor: "#E03C31", secondaryColor: "#E07A28" },
  { slug: "tigers", name: "Tigers", abbr: "TIG", primaryColor: "#F26522", secondaryColor: "#111111" },
  { slug: "voyagers", name: "Voyagers", abbr: "VOY", primaryColor: "#0055A4", secondaryColor: "#F5D76E" },
  { slug: "wizards", name: "Wizards", abbr: "WIZ", primaryColor: "#3B4CCA", secondaryColor: "#F5D76E" },
];

export function maddenRelocationLogoPath(slug: string): string {
  return `/assets/relocation-logos/${slug}.svg`;
}

export function maddenRelocationCityById(id: string): MaddenRelocationCity | undefined {
  return MADDEN_RELOCATION_CITIES.find((city) => city.id === id);
}

export function maddenRelocationBrandBySlug(slug: string): MaddenRelocationBrand | undefined {
  return MADDEN_RELOCATION_BRANDS.find((brand) => brand.slug === slug);
}

export function maddenRelocationBrandsForCity(cityId: string): MaddenRelocationBrand[] {
  return MADDEN_RELOCATION_BRANDS.filter((brand) => !brand.houstonOnly || cityId === "houston");
}

export function formatRelocationCityLabel(city: MaddenRelocationCity): string {
  return city.region ? `${city.name} (${city.region})` : city.name;
}
