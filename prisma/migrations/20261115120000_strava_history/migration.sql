-- Strava : rattrapage de tout l'historique (ajouts seulement).
ALTER TABLE "StravaAccount" ADD COLUMN "historyBefore" DATETIME;
ALTER TABLE "StravaAccount" ADD COLUMN "historyDoneAt" DATETIME;
ALTER TABLE "StravaAccount" ADD COLUMN "firstRideAt" DATETIME;
