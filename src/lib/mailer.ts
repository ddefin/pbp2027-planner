import nodemailer from "nodemailer";
import { config } from "../config.js";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!config.smtp) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465, // 465 = TLS implicite ; 587/25 = STARTTLS, géré automatiquement par nodemailer
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    });
  }
  return transporter;
}

// false = SMTP non configuré (l'appelant répond "non configuré" plutôt que de
// planter) ou envoi échoué — jamais d'exception qui remonterait jusqu'à la requête
// HTTP, la réinitialisation de mot de passe ne doit jamais crasher le serveur.
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.sendMail({
      from: config.smtp?.from,
      to,
      subject: "Réinitialisation de ton mot de passe — PBP2027 Planner",
      text: `Pour réinitialiser ton mot de passe, ouvre ce lien (valable 1 heure) :\n\n${resetUrl}\n\nSi tu n'es pas à l'origine de cette demande, ignore cet email : ton mot de passe reste inchangé.`,
    });
    return true;
  } catch {
    return false;
  }
}
