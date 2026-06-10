import { describe, it, expect, vi, afterEach } from "vitest";
import { createWeatherObserver } from "../../../src/sentinel/observers/weather.js";

const MOCK_WTTR_RESPONSE = {
  current_condition: [
    {
      temp_F: "78",
      humidity: "30",
      weatherDesc: [{ value: "Partly cloudy" }],
      precipMM: "2.5",
    },
  ],
  weather: [
    {
      date: "2026-06-05",
      maxtempF: "85",
      mintempF: "62",
      hourly: [],
    },
  ],
};

describe("weather observer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches wttr.in and emits one observation with parsed metrics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_WTTR_RESPONSE,
      }),
    );

    const obs = createWeatherObserver({ location: "Salt Lake City" });
    const results = await obs.observe(0);

    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.source).toBe("weather");
    expect(r.topic).toBe("weather:forecast");
    expect(r.summary).toContain("Salt Lake City");
    expect(r.summary).toContain("78F");
    expect(r.summary).toContain("Partly cloudy");
    expect(r.metrics?.temp_f).toBe(78);
    expect(r.metrics?.humidity_pct).toBe(30);
    // precip_pct derived from precipMM > 0
    expect(typeof r.metrics?.precip_pct).toBe("number");
    expect(r.metrics?.condition_code).toBeDefined();
  });

  it("returns empty array on non-200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      }),
    );

    const obs = createWeatherObserver({ location: "Salt Lake City" });
    const results = await obs.observe(0);
    expect(results).toHaveLength(0);
  });

  it("returns empty array when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const obs = createWeatherObserver({ location: "Salt Lake City" });
    const results = await obs.observe(0);
    expect(results).toHaveLength(0);
  });
});
