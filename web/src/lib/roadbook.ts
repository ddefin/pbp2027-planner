// Ré-export : la source unique des calculs du roadbook vit côté serveur
// (src/shared/roadbookCalc.ts), pour que le résumé Telegram et l'interface calculent
// exactement la même chose.
export * from "../../../src/shared/roadbookCalc";
