-- Statut et petit mot à chaque pointage, lien Strava Beacon sur le roadbook (ajouts seulement).
ALTER TABLE "RoadbookCheckin" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'route';
ALTER TABLE "RoadbookCheckin" ADD COLUMN "message" TEXT;
ALTER TABLE "Roadbook" ADD COLUMN "beaconUrl" TEXT;
