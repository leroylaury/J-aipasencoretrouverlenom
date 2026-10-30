import { createClient } from
    "https://esm.sh/@supabase/supabase-js@2";

// Informations publiques du projet Supabase
const SUPABASE_URL = "https://jtasqbcdkzocinxvtujs.supabase.co";
const SUPABASE_KEY = "psb_publishable_nRv-Tfo3J9UE5hm0qLJT0A_i116YPuh";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

// Connexion Discord
export async function signInWithDiscord() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      redirectTo: window.location.href.split('#')[0]
    }
  });

  if (error) {
    console.error("Erreur de connexion Discord :", error);
    alert("Impossible de se connecter à Discord.");
  }
}

// Déconnexion
export async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("Erreur de déconnexion :", error);
  }
}

// Récupération de la session
export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error(error);
    return null;
  }

  return data.session;
}

// Synchronisation de l'identité Discord (Rôles)
export async function syncDiscordIdentity() {
  const { error } = await supabase.rpc("sync_my_discord_identity");

  if (error) {
    console.error("Synchronisation Discord impossible :", error);
  }
}
