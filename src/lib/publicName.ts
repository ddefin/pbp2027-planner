// L'email n'est jamais exposé aux autres utilisateurs : seule la partie avant
// le "@" sert de nom affiché. Pas encore de vrai pseudo configurable.
export function publicName(email: string): string {
  return email.split("@")[0];
}
