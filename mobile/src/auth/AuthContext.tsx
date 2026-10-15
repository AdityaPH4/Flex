import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import { GoogleSignin, isSuccessResponse } from "@react-native-google-signin/google-signin";
import { api, setAuthToken, ApiError } from "../api/client";
import type { EmployeeProfile } from "../api/types";
import {
  saveSessionToken,
  loadSessionToken,
  clearAllAuthData,
  getOrCreateDeviceId,
  saveIdentityCache,
  loadIdentityCache,
  type CachedIdentity,
} from "./secureCache";

// The native Google Sign-In module has no real web implementation (its web
// branch is a sponsor-only stub that just throws - see login.tsx for the
// actual web sign-in path, built on Google's own Identity Services JS SDK).
// Calling .configure() on web only logs a warning, but there's no reason to
// even try.
if (Platform.OS !== "web") {
  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });
}

interface AuthState {
  isBootstrapping: boolean; // still checking for an existing session on app start
  isAuthenticated: boolean;
  profile: EmployeeProfile | null;
  cachedIdentity: CachedIdentity | null; // available even offline
  signInWithGoogle: () => Promise<void>;
  // The web login screen gets its ID token from Google's Identity Services
  // JS SDK directly, then hands it here to finish the same way native does.
  signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [cachedIdentity, setCachedIdentity] = useState<CachedIdentity | null>(null);

  // On cold start: if we have a stored token, wire it into the API client
  // immediately (so the app can show the cached identity right away even
  // before/without network), then try to refresh the live profile.
  useEffect(() => {
    (async () => {
      const [token, cached] = await Promise.all([loadSessionToken(), loadIdentityCache()]);
      if (cached) setCachedIdentity(cached);

      if (token) {
        setAuthToken(token);
        setIsAuthenticated(true);
        try {
          const me = await api.me();
          setProfile(me);
          await saveIdentityCache({
            employeeId: me.id,
            employeeCode: me.employeeCode,
            name: me.name,
            photoUrl: me.photoUrl,
          });
        } catch (err) {
          // Offline, or the session was revoked server-side.
          if (err instanceof ApiError && (err.status === 401)) {
            await clearAllAuthData();
            setAuthToken(null);
            setIsAuthenticated(false);
          }
          // Any other error (network unreachable) - stay authenticated and
          // rely on the cached identity; online screens will show their own
          // offline state when they try to fetch balance/history.
        }
      }
      setIsBootstrapping(false);
    })();
  }, []);

  // Shared by both sign-in paths below - native gets its ID token from the
  // native Google SDK, web gets it from Google's own Identity Services JS
  // SDK (see login.tsx) - but everything from here on (session, profile,
  // offline identity cache) is identical either way.
  const completeSignIn = useCallback(async (idToken: string) => {
    const deviceId = await getOrCreateDeviceId();
    const { token } = await api.googleSignIn({ idToken, deviceId });
    await saveSessionToken(token);
    setAuthToken(token);

    const me = await api.me();
    await saveIdentityCache({
      employeeId: me.id,
      employeeCode: me.employeeCode,
      name: me.name,
      photoUrl: me.photoUrl,
    });
    setProfile(me);
    setCachedIdentity({
      employeeId: me.id,
      employeeCode: me.employeeCode,
      name: me.name,
      photoUrl: me.photoUrl,
      cachedAt: new Date().toISOString(),
    });
    setIsAuthenticated(true);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response) || !response.data.idToken) {
      throw new Error("google_sign_in_cancelled");
    }
    await completeSignIn(response.data.idToken);
  }, [completeSignIn]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Even if the network call fails, still clear local state below -
      // the person asked to sign out and the device shouldn't keep showing
      // their data regardless of connectivity.
    }
    try {
      // Clears the native Google session too, so a future sign-in on this
      // device shows the account picker again instead of silently reusing
      // whoever signed in last (relevant if the phone changes hands).
      await GoogleSignin.signOut();
    } catch {
      // best-effort
    }
    try {
      await clearAllAuthData();
    } catch {
      // best-effort (e.g. Android Keystore invalidated by an OS/security-
      // setting change) - still force the in-memory auth state below so the
      // UI doesn't get stuck mid-sign-out even if secure storage couldn't
      // be cleared.
    }
    setAuthToken(null);
    setIsAuthenticated(false);
    setProfile(null);
    setCachedIdentity(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const me = await api.me();
    setProfile(me);
    await saveIdentityCache({
      employeeId: me.id,
      employeeCode: me.employeeCode,
      name: me.name,
      photoUrl: me.photoUrl,
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isBootstrapping,
        isAuthenticated,
        profile,
        cachedIdentity,
        signInWithGoogle,
        signInWithGoogleIdToken: completeSignIn,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
