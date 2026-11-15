import { describe, expect, it } from "vitest";
import { hoursMinutes, hoursMinutesSpoken } from "../web/src/components/strava/stravaFormat.js";

describe("Durées Strava en heures et minutes", () => {
  it("écrit 21 h 36 plutôt que 21,6 h", () => {
    expect(hoursMinutes(21.6)).toBe("21 h 36");
    expect(hoursMinutes(0.75)).toBe("45 min");
    expect(hoursMinutes(3)).toBe("3 h");
    expect(hoursMinutes(25.5)).toBe("25 h 30");
    expect(hoursMinutes(2.999)).toBe("3 h"); // arrondi à la minute
    expect(hoursMinutes(112.0833)).toBe("112 h 05");
    expect(hoursMinutes(0)).toBe("0 min");
  });
  it("donne une version lue par VoiceOver", () => {
    expect(hoursMinutesSpoken(21.6)).toBe("21 heures 36 minutes");
    expect(hoursMinutesSpoken(1)).toBe("1 heure");
    expect(hoursMinutesSpoken(1 / 60)).toBe("1 minute");
  });
});
