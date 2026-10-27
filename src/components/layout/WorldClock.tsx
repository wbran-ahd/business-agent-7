import { useEffect, useState } from "react";

type Zone = {
  city: string;
  timeZone: string;
  shortLabel: string;
};

const timeZones: Zone[] = [
  { city: "Karachi", timeZone: "Asia/Karachi", shortLabel: "PKT" },
  { city: "UTC", timeZone: "UTC", shortLabel: "UTC" },
  { city: "London", timeZone: "Europe/London", shortLabel: "GMT" },
  { city: "New York", timeZone: "America/New_York", shortLabel: "EST" },
  { city: "Dubai", timeZone: "Asia/Dubai", shortLabel: "GST" },
  { city: "Tokyo", timeZone: "Asia/Tokyo", shortLabel: "JST" },
];

function formatTimeInZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDateInZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function WorldClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-white/40">
          World Clock
        </p>
        <span className="font-sans text-[10px] text-sky-300/80">Live</span>
      </div>

      <div className="grid gap-2">
        {timeZones.map((zone) => {
          const time = formatTimeInZone(now, zone.timeZone);
          const date = formatDateInZone(now, zone.timeZone);

          return (
            <div
              key={zone.timeZone}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/40 px-2.5 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">
                  {zone.city}
                </p>
                <p className="mt-1 font-sans text-[10px] text-white/45">{date}</p>
              </div>

              <div className="text-left">
                <p className="font-mono text-sm font-bold tracking-[0.18em] text-white">
                  {time}
                </p>
                <p className="font-sans text-[10px] text-sky-300/80">{zone.shortLabel}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
