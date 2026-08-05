import {
  acceptInvite,
  AuthError,
  getUser,
  handleAuthCallback,
  login,
  logout,
  onAuthChange,
  signup,
  updateUser
} from "@netlify/identity";

export type NetlifyAuthUser = {
  id?: string;
  email?: string;
  name?: string;
  confirmedAt?: string;
  app_metadata?: {
    roles?: string[];
  };
};

export type NetlifyAuthChallenge =
  | { type: "recovery" }
  | { type: "invite"; token: string };

export function shouldUseNetlifyIdentity() {
  if (typeof window === "undefined") return false;
  return !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

export async function initializeNetlifyIdentity() {
  const callback = await handleAuthCallback();
  const challenge: NetlifyAuthChallenge | null =
    callback?.type === "recovery"
      ? { type: "recovery" }
      : callback?.type === "invite" && callback.token
        ? { type: "invite", token: callback.token }
        : null;

  return {
    user: normalizeNetlifyUser(await getUser()),
    challenge
  };
}

export async function checkNetlifyIdentitySettings() {
  try {
    const response = await fetch("/.netlify/identity", {
      headers: { accept: "application/json" }
    });
    if (response.status === 404) {
      return "Netlify Identity is not enabled for this site yet.";
    }
    if (response.ok || response.status === 401 || response.status === 405) return "";
    return "";
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Netlify Identity settings are not available for this site.";
  }
}

export function watchNetlifyIdentity(onChange: (user: NetlifyAuthUser | null) => void) {
  return onAuthChange((_event, user) => onChange(normalizeNetlifyUser(user)));
}

export async function loginWithNetlifyIdentity(email: string, password: string) {
  try {
    return { user: normalizeNetlifyUser(await login(email, password)), error: "" };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        user: null,
        error: error.status === 401 ? "Invalid Netlify Identity email or password." : error.message
      };
    }
    return {
      user: null,
      error: error instanceof Error ? error.message : "Netlify Identity login failed."
    };
  }
}

export async function createNetlifyIdentityAccount(email: string, password: string, name: string) {
  try {
    const user = normalizeNetlifyUser(await signup(email, password, { full_name: name }));
    return { user, needsConfirmation: !user?.confirmedAt, error: "" };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        user: null,
        needsConfirmation: false,
        error:
          error.status === 422
            ? "That account could not be created. It may already exist, or the password may not meet Netlify requirements."
            : error.message
      };
    }
    return {
      user: null,
      needsConfirmation: false,
      error: error instanceof Error ? error.message : "Netlify Identity account creation failed."
    };
  }
}

export async function completeNetlifyIdentityChallenge(
  challenge: NetlifyAuthChallenge,
  password: string
) {
  try {
    const user =
      challenge.type === "invite"
        ? await acceptInvite(challenge.token, password)
        : await updateUser({ password });
    return { user: normalizeNetlifyUser(user), error: "" };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        user: null,
        error:
          error.status === 422
            ? "That password could not be saved. Use at least 8 characters and try again."
            : error.message
      };
    }
    return {
      user: null,
      error: error instanceof Error ? error.message : "Netlify Identity password setup failed."
    };
  }
}

export async function logoutNetlifyIdentity() {
  await logout();
}

function normalizeNetlifyUser(user: unknown): NetlifyAuthUser | null {
  if (!user || typeof user !== "object") return null;
  return user as NetlifyAuthUser;
}
