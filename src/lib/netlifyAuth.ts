import {
  AuthError,
  getUser,
  handleAuthCallback,
  login,
  logout,
  onAuthChange
} from "@netlify/identity";

export type NetlifyAuthUser = {
  id?: string;
  email?: string;
  name?: string;
  app_metadata?: {
    roles?: string[];
  };
};

export function shouldUseNetlifyIdentity() {
  if (typeof window === "undefined") return false;
  return !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

export async function initializeNetlifyIdentity() {
  await handleAuthCallback();
  return normalizeNetlifyUser(await getUser());
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

export async function logoutNetlifyIdentity() {
  await logout();
}

function normalizeNetlifyUser(user: unknown): NetlifyAuthUser | null {
  if (!user || typeof user !== "object") return null;
  return user as NetlifyAuthUser;
}
