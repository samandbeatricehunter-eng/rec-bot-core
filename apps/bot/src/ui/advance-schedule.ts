import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";

export const ADVANCE_SCHEDULE_CUSTOM_IDS = {
  daySelect: "rec:advance_schedule:day",
  hourSelect: "rec:advance_schedule:hour",
  tzSelect: "rec:advance_schedule:tz",
  confirm: "rec:advance_schedule:confirm"
} as const;

// EST/CST/PST/AKST as the user-facing labels, mapped to IANA zones (matches the API's TIME_ZONES).
export const SCHEDULE_TIMEZONES = [
  { label: "EST", value: "America/New_York" },
  { label: "CST", value: "America/Chicago" },
  { label: "PST", value: "America/Los_Angeles" },
  { label: "AKST", value: "America/Anchorage" }
] as const;

export const DEFAULT_SCHEDULE_TIMEZONE = "America/New_York";

export type AdvanceScheduleState = {
  date?: string; // "YYYY-MM-DD" wall-clock date in the chosen timezone
  hour?: number; // 0-23
  timezone?: string; // IANA zone
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function tzLabel(timeZone: string) {
  return SCHEDULE_TIMEZONES.find((z) => z.value === timeZone)?.label ?? timeZone;
}

// Wall-clock "now" in a timezone, so we can offer only future days/hours.
function nowPartsInZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit"
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return { year: Number(m.year), month: Number(m.month), day: Number(m.day), hour: Number(m.hour) };
}

// Calendar-date arithmetic via a UTC carrier (no tz math needed to just count days forward).
function addDays(year: number, month: number, day: number, n: number) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + n);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekdayLong: d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
    monthShort: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
  };
}

function hourLabel(hour: number) {
  const period = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${period}`;
}

// Convert a wall-clock (date + hour) in a timezone to the precise UTC instant.
export function wallClockToUtc(year: number, month: number, day: number, hour: number, timeZone: string) {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, 0, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(new Date(naiveUtcMs));
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const asTzMs = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), Number(m.hour), Number(m.minute), Number(m.second));
  const offset = asTzMs - naiveUtcMs;
  return new Date(naiveUtcMs - offset);
}

function dayOptions(timeZone: string, selected?: string) {
  const today = nowPartsInZone(timeZone);
  const options: StringSelectMenuOptionBuilder[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(today.year, today.month, today.day, i);
    const value = `${d.year}-${pad(d.month)}-${pad(d.day)}`;
    const label = `${d.weekdayLong}, ${d.monthShort} ${d.day}${i === 0 ? " (Today)" : ""}`;
    options.push(new StringSelectMenuOptionBuilder().setLabel(label).setValue(value).setDefault(value === selected));
  }
  return options;
}

function hourOptions(timeZone: string, selectedDate?: string, selectedHour?: number) {
  const today = nowPartsInZone(timeZone);
  const todayValue = `${today.year}-${pad(today.month)}-${pad(today.day)}`;
  const isToday = selectedDate === todayValue;
  const options: StringSelectMenuOptionBuilder[] = [];
  for (let h = 0; h < 24; h++) {
    // For today, only allow hours strictly after the current hour so a past/now time can't be picked.
    if (isToday && h <= today.hour) continue;
    options.push(new StringSelectMenuOptionBuilder().setLabel(hourLabel(h)).setValue(String(h)).setDefault(h === selectedHour));
  }
  return options;
}

export function buildAdvanceSchedulePayload(state: AdvanceScheduleState) {
  const timezone = state.timezone ?? DEFAULT_SCHEDULE_TIMEZONE;
  const hours = hourOptions(timezone, state.date, state.hour);

  const daySelect = new StringSelectMenuBuilder()
    .setCustomId(ADVANCE_SCHEDULE_CUSTOM_IDS.daySelect)
    .setPlaceholder("Select advance day")
    .addOptions(dayOptions(timezone, state.date));

  const hourSelect = new StringSelectMenuBuilder()
    .setCustomId(ADVANCE_SCHEDULE_CUSTOM_IDS.hourSelect)
    .setPlaceholder(hours.length ? "Select advance time" : "No remaining times today — pick another day")
    .setDisabled(hours.length === 0)
    .addOptions(hours.length ? hours : [new StringSelectMenuOptionBuilder().setLabel("No times available").setValue("none")]);

  const tzSelect = new StringSelectMenuBuilder()
    .setCustomId(ADVANCE_SCHEDULE_CUSTOM_IDS.tzSelect)
    .setPlaceholder("Select timezone")
    .addOptions(SCHEDULE_TIMEZONES.map((z) => new StringSelectMenuOptionBuilder().setLabel(z.label).setValue(z.value).setDefault(z.value === timezone)));

  const ready = Boolean(state.date) && state.hour != null && Boolean(state.timezone);
  let preview = "Select a day, time, and timezone to set the next advance.";
  if (ready) {
    const [y, mo, d] = state.date!.split("-").map(Number);
    const when = wallClockToUtc(y, mo, d, state.hour!, timezone);
    const label = new Intl.DateTimeFormat("en-US", {
      weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone, timeZoneName: "short"
    }).format(when);
    preview = `Next advance will be set to:\n**${label}**`;
  }

  const confirm = new ButtonBuilder()
    .setCustomId(ADVANCE_SCHEDULE_CUSTOM_IDS.confirm)
    .setLabel("Confirm Next Advance")
    .setStyle(ButtonStyle.Success)
    .setDisabled(!ready);

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Set Next Advance")
        .setDescription([
          "Choose when the next advance deadline falls. The day list covers the next 7 days; the time list only shows hours still ahead for the selected day.",
          "",
          preview,
          "",
          `Selected timezone: **${tzLabel(timezone)}**`
        ].join("\n"))
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(daySelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(hourSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(tzSelect),
      new ActionRowBuilder<ButtonBuilder>().addComponents(confirm)
    ]
  };
}
