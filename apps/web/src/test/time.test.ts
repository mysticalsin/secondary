// Times are shown where the viewer is, not in UTC and not in one fixed city.

import { describe, expect, it } from "vitest";
import { localHm, localHms, localParts, zoneName } from "../lib/time";
import { dayLabel, hm, hms } from "../ops/format";

const AT = "2026-11-06T02:30:45.000Z";

describe("viewer time zone", () => {
  it("reads an instant in the zone asked for", () => {
    expect(localHm(AT, "America/Toronto")).toBe("21:30"); // 5 h behind in November
    expect(localHms(AT, "Asia/Ho_Chi_Minh")).toBe("09:30:45");
    expect(localParts(AT, "America/Toronto")).toMatchObject({ mo: 11, d: 5, h: 21 });
    expect(localParts(AT, "Asia/Ho_Chi_Minh")).toMatchObject({ mo: 11, d: 6, h: 9 });
    expect(localHm("not a date")).toBe("not a date");
  });

  it("the Operate formatters follow the browser's zone (set to UTC for the tests, then to Sao Paulo)", () => {
    expect(hms(AT)).toBe("02:30:45");
    expect(hm(AT)).toBe("02:30");
    expect(dayLabel(AT, "en")).toBe("Nov 6");
    const was = process.env.TZ;
    try {
      process.env.TZ = "America/Sao_Paulo"; // UTC-3
      expect(hms(AT)).toBe("23:30:45");
      expect(dayLabel(AT, "en")).toBe("Nov 5");
      expect(dayLabel(AT, "fr")).toBe("5 nov.");
      expect(zoneName(Date.parse(AT))).toMatch(/GMT-3|BRT/);
    } finally {
      process.env.TZ = was;
    }
    expect(hm(AT)).toBe("02:30");
  });
});
