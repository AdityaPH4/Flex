export interface EmployeeProfile {
  id: string;
  employeeCode: string;
  name: string;
  photoUrl: string | null;
  designation: string | null;
  department: string | null;
  role: string;
  homeOutlet: string | null;
}

export interface CurrentBalance {
  year: number;
  month: number;
  allowance: number;
  used: number;
  remaining: number;
  validFrom: string | null; // YYYY-MM-DD; null = no limit on that side
  validTo: string | null;
  ended?: boolean; // valid-to (or last working) day is over; optional so an older server still works
}

export interface Transaction {
  id: string;
  outlet: string;
  amount: number;
  cashAmount: number | null;
  billNo: string | null;
  occurredAt: string;
  notes: string | null;
  status: string;
  reconciliationCode: string | null;
}

export interface ReconciliationCodeResponse {
  code: string;
  expiresAt: string;
  expiresInSeconds: number;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}
