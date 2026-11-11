import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  computeLiveStatus,
  controlWindow,
  formatMinutes,
  looksLikeControl,
  plannedMinuteAt,
  snapToRoute,
  type PacingSettings,
} from "../src/shared/roadbookCalc.js";

const brm200: PacingSettings = { movingSpeedKmh: 25, climbPenaltyMinPer100m: 0, classKm: 200, limitMinutes: 810 };

describe("Barème ACP/RUSA des contrôles", () => {
  it.each([
    // [km, distance nominale, délai, ouverture attendue, fermeture attendue]
    [0, 200, 810, 0, 60],
    [60, 200, 810, 106, 240], // ≤ 60 km : 20 km/h + 1h
    [50, 200, 810, 88, 210], // 50/20 + 1h = 3h30 (au lieu de 3h20 à 15 km/h)
    [100, 200, 810, 176, 400],
    [175, 200, 810, 309, 700],
    [200, 200, 810, 353, 810], // arrivée : délai officiel (13h30, pas 13h20)
    [207, 200, 810, 353, 810], // arrivée réelle au-delà de la distance nominale
    [300, 400, 1620, 540, 1200], // 200/34 + 100/32 = 9h00
    [405, 400, 1620, 728, 1620], // arrivée d'un 400 : 27h
    [550, 600, 2400, 1028, 2200], // 17h08 / 36h40
  ])("km %d d'un %d : ouverture %d min, fermeture %d min", (km, classKm, limit, open, close) => {
    expect(controlWindow(km, classKm, limit)).toEqual({ openMin: open, closeMin: close });
  });
});

describe("Roadbook de passage", () => {
  const controls = [
    { name: "Départ", km: 0, stopMinutes: 0 },
    { name: "CP1", km: 50, stopMinutes: 15 },
    { name: "CP2", km: 125, stopMinutes: 30 },
    { name: "Arrivée", km: 200, stopMinutes: 20 },
  ];

  it("cumule roulage et pauses, sans compter la pause de l'arrivée", () => {
    const rows = buildSchedule(controls, [], brm200);
    expect(rows.map((r) => r.arriveMin)).toEqual([0, 120, 315, 525]); // 2h, +15 +3h, +30 +3h
    expect(rows[3].stopMinutes).toBe(0);
    expect(rows[3].marginMin).toBe(810 - 525);
  });

  it("ferme toujours l'arrivée au délai officiel, même sur un GPX un peu plus court que le nominal", () => {
    const rows = buildSchedule(
      [
        { name: "Départ", km: 0, stopMinutes: 0 },
        { name: "Arrivée", km: 199.8, stopMinutes: 0 },
      ],
      [],
      brm200,
    );
    expect(rows[1].closeMin).toBe(810);
  });

  it("ajoute la pénalité de montée par tranche de 100 m de D+", () => {
    const points = Array.from({ length: 51 }, (_, i) => ({ distKm: i, ele: 100 + i * 10 })); // +500 m sur 50 km
    const rows = buildSchedule(controls.slice(0, 2), points, { ...brm200, climbPenaltyMinPer100m: 6 });
    expect(rows[1].legGainM).toBe(500);
    expect(rows[1].arriveMin).toBe(120 + 30);
  });

  it("compare à l'arrivée prévue au contrôle, puis interpole depuis la sortie du contrôle", () => {
    const rows = buildSchedule(controls, [], brm200);
    expect(plannedMinuteAt(rows, 50)).toBe(120); // arrivée à CP1 (pause pas encore prise)
    expect(plannedMinuteAt(rows, 87.5)).toBe(135 + 90); // reparti à 2h15, 37,5 km à 25 km/h
  });
});

describe("Statut live", () => {
  const controls = [
    { name: "Départ", km: 0, stopMinutes: 0 },
    { name: "CP1", km: 100, stopMinutes: 20 },
    { name: "Arrivée", km: 200, stopMinutes: 0 },
  ];
  const schedule = buildSchedule(controls, [], brm200);

  it("vert quand on est en avance sur son plan et loin des barrières", () => {
    const s = computeLiveStatus({ schedule, km: 60, elapsedMin: 120, settings: brm200, totalKm: 200 });
    expect(s.planDeltaMin).toBe(144 - 120);
    expect(s.planLevel).toBe("ok");
    expect(s.nextControl?.name).toBe("CP1");
    expect(s.barrierLevel).toBe("ok");
  });

  it("orange quand le retard sur le plan reste modéré", () => {
    const s = computeLiveStatus({ schedule, km: 60, elapsedMin: 160, settings: brm200, totalKm: 200 });
    expect(s.planLevel).toBe("tight");
  });

  it("rouge sur la barrière quand le prochain contrôle fermera avant d'y arriver à sa vitesse", () => {
    // km 60 à 5h30 : CP1 (km 100) ferme à 6h40 ; 40 km à 25 km/h = 1h36 → arrivée 7h06.
    const s = computeLiveStatus({ schedule, km: 60, elapsedMin: 330, settings: brm200, totalKm: 200 });
    expect(s.barrierLevel).toBe("late");
    expect(s.barrierMarginMin).toBe(400 - (330 + 96));
    expect(s.requiredSpeedNextKmh).toBeCloseTo(34.3, 1);
  });

  it("n'élimine pas entre deux contrôles tant que le suivant reste atteignable", () => {
    // km 80 à 5h40 : sous la ligne des 15 km/h (80 km = 5h20), mais CP1 (km 100)
    // ferme à 6h40 et 20 km à 25 km/h = 48 min → arrivée 6h28, ça passe.
    const s = computeLiveStatus({ schedule, km: 80, elapsedMin: 340, settings: brm200, totalKm: 200 });
    expect(s.closedAlready).toBe(false);
    expect(s.barrierMarginMin).toBe(400 - (340 + 48));
    expect(s.barrierLevel).toBe("tight");
  });

  it("signale hors délai quand le prochain contrôle est déjà fermé", () => {
    const s = computeLiveStatus({ schedule, km: 90, elapsedMin: 410, settings: brm200, totalKm: 200 });
    expect(s.closedAlready).toBe(true);
    expect(s.barrierLevel).toBe("late");
  });

  it("donne la moyenne restante nécessaire pour finir dans le délai", () => {
    const s = computeLiveStatus({ schedule, km: 100, elapsedMin: 300, settings: brm200, totalKm: 200 });
    expect(s.remainingKm).toBe(100);
    expect(s.requiredSpeedFinishKmh).toBeCloseTo(100 / ((810 - 300) / 60), 1);
  });
});

describe("Utilitaires", () => {
  it("recale une position GPS sur le bon sens d'un aller-retour grâce au dernier km connu", () => {
    // Aller vers l'est sur 50 km puis retour sur la même route.
    const points = [
      ...Array.from({ length: 51 }, (_, i) => ({ lat: 48, lon: 2 + i * 0.0135, distKm: i })),
      ...Array.from({ length: 50 }, (_, i) => ({ lat: 48.0005, lon: 2 + (49 - i) * 0.0135, distKm: 51 + i })),
    ];
    const pos = { lat: 48.0003, lon: 2 + 20 * 0.0135 };
    expect(snapToRoute(points, pos, 75).km).toBeGreaterThan(70); // sur le retour
    expect(snapToRoute(points, pos, 15).km).toBeLessThan(25); // à l'aller
  });

  it("sur une boucle, recale la ligne d'arrivée à la fin et non au départ quand on vient de loin", () => {
    // Boucle de ~100 km : départ et arrivée au même endroit.
    const loop = Array.from({ length: 101 }, (_, i) => {
      const a = (i / 100) * 2 * Math.PI;
      return { lat: 48 + 0.143 * Math.sin(a), lon: 2 + 0.214 * (1 - Math.cos(a)), distKm: i };
    });
    expect(snapToRoute(loop, { lat: 48, lon: 2 }, 97).km).toBe(100);
    expect(snapToRoute(loop, { lat: 48, lon: 2 }, null).km).toBe(0); // sans historique : le départ
  });

  it("projette sur le segment, pas sur le sommet le plus proche (longue ligne droite simplifiée)", () => {
    // Deux sommets seulement, à 20 km d'écart : une position au milieu doit donner km 10.
    const line = [
      { lat: 48, lon: 2, distKm: 0 },
      { lat: 48, lon: 2 + 20 / 74.49, distKm: 20 },
    ];
    const r = snapToRoute(line, { lat: 48.001, lon: 2 + 10 / 74.49 }, null);
    expect(r.km).toBeCloseTo(10, 1);
    expect(r.offsetKm).toBeLessThan(0.2);
  });

  it("reconnaît les waypoints qui ressemblent à des contrôles", () => {
    expect(looksLikeControl("CP2 Boulangerie")).toBe(true);
    expect(looksLikeControl("Contrôle secret")).toBe(true);
    expect(looksLikeControl("Fontaine")).toBe(false);
  });

  it("formate les durées signées", () => {
    expect(formatMinutes(810)).toBe("13h30");
    expect(formatMinutes(-45)).toBe("−0h45");
  });
});
