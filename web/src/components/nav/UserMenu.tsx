import { Link, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { Avatar } from "../Avatar";
import { Dropdown } from "./Dropdown";
import { ACCOUNT_LINKS } from "./navLinks";
import { ThemeChoice } from "./ThemeChoice";

export function useSignOut() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return async () => {
    await logout();
    navigate("/login", { replace: true });
  };
}

// Menu du compte (bureau) : avatar + prénom, profil, thème, déconnexion en toutes lettres.
export function UserMenu() {
  const { user } = useAuth();
  const signOut = useSignOut();
  if (!user) return null;
  return (
    <Dropdown
      className="app-user"
      align="end"
      label={`Mon compte : ${user.prenom}`}
      trigger={
        <>
          <Avatar name={user.prenom} avatar={user.avatar} size={30} />
          <span className="app-user-name">{user.prenom}</span>
        </>
      }
    >
      {(close) => (
        <>
          <div className="app-dd-head">
            <strong>{user.prenom}</strong>
            <span>{user.isAdmin ? "Administrateur" : "Randonneur"}</span>
          </div>
          {ACCOUNT_LINKS.map((l) => (
            <Link key={l.to} to={l.to} role="menuitem" className="app-dd-item" onClick={close}>
              <l.icon size={17} aria-hidden="true" /> {l.label}
            </Link>
          ))}
          <div className="app-dd-sep" role="separator" />
          <div className="app-dd-block">
            <span className="app-dd-cap">Thème</span>
            <ThemeChoice />
          </div>
          <div className="app-dd-sep" role="separator" />
          <button type="button" role="menuitem" className="app-dd-item is-danger" onClick={() => void signOut()}>
            <LogOut size={17} aria-hidden="true" /> Déconnexion
          </button>
        </>
      )}
    </Dropdown>
  );
}
