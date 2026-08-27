import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
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

interface AuthState {
  isBootstrapping: boolean; // still checking for an existing session on app start
  isAuthenticated: boolean;
  profile: EmployeeProfile | null;
  cachedIdentity: CachedIdentity | null; // available even offline
  requestOtp: (phone: string) => Promise<{ requestId: string; expiresInSeconds: number }>;
  verifyOtp: (requestId: string, code: string) => Promise<void>;
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

  const requestOtp = useCallback(async (phone: string) => {
    return api.requestOtp(phone);
  }, []);

  const verifyOtp = useCallback(async (requestId: string, code: string) => {
    const deviceId = await getOrCreateDeviceId();
    const { token } = await api.verifyOtp({ requestId, code, deviceId });
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

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Even if the network call fails, still clear local state below -
      // the person asked to sign out and the device shouldn't keep showing
      // their data regardless of connectivity.
    }
    await clearAllAuthData();
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
        requestOtp,
        verifyOtp,
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
