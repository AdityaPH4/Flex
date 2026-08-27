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
}

export interface TransactionItem {
  name: string;
  amount: number;
}

export interface Transaction {
  id: string;
  outlet: string;
  amount: number;
  items: TransactionItem[] | null;
  occurredAt: string;
  notes: string | null;
  status: string;
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
