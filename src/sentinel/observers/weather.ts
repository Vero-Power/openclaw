import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

export interface WeatherObserverDeps {
  /** Geographic location to fetch forecast for. Defaults to OPENCLAW_SENTINEL_LOCATION env, then "Salt Lake City". */
  location?: string;
}

/**
 * Fetches today's weather forecast from wttr.in (free, no auth).
 * Emits one observation per cycle with topic "weather:forecast".
 *
 * On any fetch error (network, timeout, non-200) returns [] to avoid crashing the runner.
 */
export function createWeatherObserver(deps: WeatherObserverDeps = {}): Observer {
  const location = deps.location ?? process.env["OPENCLAW_SENTINEL_LOCATION"] ?? "Salt Lake City";

  return {
    name: "weather",

    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, 5000);

      let body: WttrJ1Response;
      try {
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) {
          return [];
        }
        body = (await resp.json()) as WttrJ1Response;
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }

      const current = body.current_condition?.[0];
      if (!current) {
        return [];
      }

      const tempF = Number(current.temp_F);
      const humidity = Number(current.humidity);
      const precipMM = Number(current.precipMM);
      const desc = current.weatherDesc?.[0]?.value ?? "Unknown";

      // Convert precipMM to a rough precip percentage (cap at 100)
      // wttr.in doesn't expose a direct probability — use a simple scale: 1mm ≈ 10%
      const precipPct = Math.min(100, Math.round(precipMM * 10));

      // condition_code: stable numeric key based on description ordinal; used as a grouping signal
      const conditionCode = stableConditionCode(desc);

      const summary = `Forecast for ${location}: ${tempF}F, ${desc}, ${precipPct}% precip`;

      return [
        {
          source: "weather",
          topic: "weather:forecast",
          timestamp: Date.now(),
          summary,
          metrics: {
            temp_f: tempF,
            humidity_pct: humidity,
            precip_pct: precipPct,
            condition_code: conditionCode,
          },
          data: {
            location,
            description: desc,
            precip_mm: precipMM,
          },
        },
      ];
    },
  };
}

/**
 * Maps a wttr.in weather description string to a stable numeric code
 * for use in metrics (allows numeric sort/comparison across cycles).
 * Not a formal WMO code — purely a local ordinal bucket.
 */
function stableConditionCode(desc: string): number {
  const lower = desc.toLowerCase();
  if (lower.includes("thunder") || lower.includes("storm")) {
    return 3;
  }
  if (lower.includes("rain") || lower.includes("drizzle") || lower.includes("shower")) {
    return 2;
  }
  if (lower.includes("cloud") || lower.includes("overcast") || lower.includes("fog")) {
    return 1;
  }
  return 0; // clear / sunny / unknown
}

// ---- wttr.in j1 response shape (minimal) ----

interface WttrCurrentCondition {
  temp_F: string;
  humidity: string;
  weatherDesc: Array<{ value: string }>;
  precipMM: string;
}

interface WttrDayForecast {
  date: string;
  maxtempF: string;
  mintempF: string;
}

interface WttrJ1Response {
  current_condition?: WttrCurrentCondition[];
  weather?: WttrDayForecast[];
}
