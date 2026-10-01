import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";

// expo-secure-store has no real web implementation (its web module is an
// empty stub - calling any method on it throws) since there's no OS
// keychain/keystore equivalent in a browser. Falls back to localStorage on
// web: weaker at-rest guarantees (no OS-level encryption), but this is the
// same trust model any ordinary website already relies on for a session
// token, and it keeps every caller below unaware of the platform split.
const store = {
  async getItemAsync(key: string): Promise<string | null> {
    if (Platform.OS === "web") return window.localStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  async setItemAsync(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") return window.localStorage.setItem(key, value);
    await SecureStore.setItemAsync(key, value);
  },
  async deleteItemAsync(key: string): Promise<void> {
    if (Platform.OS === "web") return window.localStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  },
};

const KEYS = {
  sessionToken: "toit.sessionToken",
  deviceId: "toit.deviceId",
  identityCache: "toit.identityCache",
};

export interface CachedIdentity {
  employeeId: string;
  employeeCode: string;
  name: string;
  photoUrl: string | null;
  cachedAt: string; // ISO timestamp - shown in the UI as "last synced"
}

// --- session token -----------------------------------------------------

export async function saveSessionToken(token: string) {
  await store.setItemAsync(KEYS.sessionToken, token);
}

export async function loadSessionToken(): Promise<string | null> {
  return store.getItemAsync(KEYS.sessionToken);
}

export async function clearSessionToken() {
  await store.deleteItemAsync(KEYS.sessionToken);
}

// --- device id -----------------------------------------------------------
// Generated once per install and persisted. Sent to the backend at login so
// the server can bind the session to a device (see Session.deviceId) -
// useful for "sign out this device" / lost-phone flows later.

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await store.getItemAsync(KEYS.deviceId);
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(16);
  const id = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await store.setItemAsync(KEYS.deviceId, id);
  return id;
}

// --- offline identity cache ----------------------------------------------
//
// Deliberately minimal: name + employee code only, never balance or
// transaction data (those stay online-only per product spec). Written ONLY
// from a successful authenticated /api/me response - never constructed from
// anything the user can type - so there's no path for someone to edit their
// own cached identity into a different employee's.
//
// SecureStore backs onto iOS Keychain / Android Keystore, so the value is
// encrypted at rest by the OS. That protects against another app or a casual
// file-system snoop reading it. It does NOT protect against a fully rooted/
// jailbroken device where the OS-level guarantees themselves are compromised -
// closing that gap would need the backend to cryptographically sign the
// cached payload and the app to verify that signature offline. That's a
// reasonable V2 hardening step if TOIT wants defense-in-depth beyond OS
// storage security; the MVP relies on OS-level encryption + strict write-path
// discipline instead of implementing signing.

export async function saveIdentityCache(identity: Omit<CachedIdentity, "cachedAt">) {
  const payload: CachedIdentity = { ...identity, cachedAt: new Date().toISOString() };
  await store.setItemAsync(KEYS.identityCache, JSON.stringify(payload));
}

export async function loadIdentityCache(): Promise<CachedIdentity | null> {
  const raw = await store.getItemAsync(KEYS.identityCache);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedIdentity;
  } catch {
    return null;
  }
}

export async function clearIdentityCache() {
  await store.deleteItemAsync(KEYS.identityCache);
}

export async function clearAllAuthData() {
  await Promise.all([clearSessionToken(), clearIdentityCache()]);
}
