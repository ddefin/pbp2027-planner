import { useCallback, useEffect, useState } from "react";
import { getProfile, updateProfile, type Profile } from "../api/profile";

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setProfile(await getProfile());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const update = useCallback(async (data: Partial<Pick<Profile, "prenom" | "licenceNumero" | "club" | "notebook">>) => {
    const updated = await updateProfile(data);
    setProfile(updated);
    return updated;
  }, []);

  return { profile, loading, update };
}
