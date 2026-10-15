import {
  ApiError,
  type CurrentBalance,
  type EmployeeProfile,
  type ReconciliationCodeResponse,
  type Transaction,
} from "./types";

// Set EXPO_PUBLIC_API_URL in mobile/.env (see .env.example). Expo inlines
// EXPO_PUBLIC_* vars at build time - no extra config needed.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

let currentToken: string | null = null;

/** Called once by AuthContext after reading the token from secure storage. */
export function setAuthToken(token: string | null) {
  currentToken = token;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      const json = await res.json();
      if (json?.error) code = json.error;
    } catch {
      // response wasn't JSON - keep the generic http_ code
    }
    throw new ApiError(res.status, code);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  googleSignIn: (params: { idToken: string; deviceId: string; deviceName?: string }) =>
    request<{ token: string; sessionExpiresInDays: number }>("/auth/google/verify", {
      method: "POST",
      body: params,
    }),

  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  me: () => request<EmployeeProfile>("/api/me"),

  currentBalance: () => request<CurrentBalance>("/api/me/benefits/current"),

  transactions: (params?: { cursor?: string }) => {
    const qs = params?.cursor ? `?cursor=${encodeURIComponent(params.cursor)}` : "";
    return request<{ transactions: Transaction[]; nextCursor: string | null }>(
      `/api/me/benefits/transactions${qs}`
    );
  },

  recordTransaction: (params: {
    amount: number;
    cashAmount?: number;
    outletName?: string;
    billNo?: string;
    notes?: string;
    idempotencyKey: string;
  }) =>
    request<{ transaction: { id: string; amount: number; occurredAt: string }; balance: CurrentBalance }>(
      "/api/me/benefits/transactions",
      { method: "POST", body: params }
    ),

  createReconciliationCode: (params: { transactionId: string }) =>
    request<ReconciliationCodeResponse>("/api/me/benefits/reconciliation-code", {
      method: "POST",
      body: params,
    }),
};

export { ApiError };
