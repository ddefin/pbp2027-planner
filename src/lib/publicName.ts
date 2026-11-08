// Nom affiché aux autres utilisateurs : le prénom renseigné à l'inscription.
// L'email n'est jamais exposé.
export function publicName(user: { prenom: string }): string {
  return user.prenom;
}
