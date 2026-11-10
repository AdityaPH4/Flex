import type { Request, Response, NextFunction } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

// How long the activity log is kept (and shown): older rows are deleted.
export const EVENT_LOG_DAYS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

// Left out: screens that poll every second or two would bury everything else,
// and reading the log is not an event worth a row in it.
const NOT_LOGGED = new Set([
  "GET /api/cashier/payments",
  "GET /api/cashier/transactions",
  "GET /api/me/benefits/transactions/:id/status",
  "GET /api/admin/events",
]);

// The routers' mount points in server.ts - anything else (static pages, /health) isn't logged.
const MOUNTS = /^\/(?:api\/(?:me|admin|cashier)|auth)(?=[/?]|$)/;

type LogInfo = {
  actor?: "employee" | "cashier" | "admin";
  employeeId?: string;
  detail?: Record<string, unknown>;
};

// Auth middleware and handlers call this to say who is acting and to add facts
// worth keeping (never passwords, tokens or whole request bodies). The row is
// written by eventLogger once the response has been sent.
export function setLog(res: Response, info: LogInfo) {
  const cur: LogInfo = res.locals.log ?? {};
  res.locals.log = { ...cur, ...info, detail: { ...cur.detail, ...info.detail } };
}

// One row per API request. Never slows or breaks a request: the write isn't
// awaited and a failure is only logged to the console.
export function eventLogger(req: Request, res: Response, next: NextFunction) {
  const base = MOUNTS.exec(req.originalUrl)?.[0];
  if (!base) return next();

  // The API answers every refusal with { error: "<code>" } - keep that code.
  let error: string | undefined;
  const json = res.json.bind(res);
  res.json = ((body?: any) => {
    if (typeof body?.error === "string") error = body.error;
    return json(body);
  }) as typeof res.json;

  res.on("finish", () => {
    // The route pattern ("/benefits/transactions/:id/status"), so ids don't
    // split one event into thousands; the ids themselves go in detail.
    const event = `${req.method} ${req.route ? base + req.route.path : req.originalUrl.split("?")[0]}`.slice(0, 200).replace(/\/$/, "");
    if (NOT_LOGGED.has(event)) return;
    const { actor = "anonymous", employeeId, detail } = (res.locals.log ?? {}) as LogInfo;
    const full = { ...req.params, ...detail };
    prisma.eventLog
      .create({
        data: {
          actor,
          employeeId,
          event,
          status: res.statusCode,
          error,
          ip: req.ip,
          detail: Object.keys(full).length ? (full as Prisma.InputJsonObject) : undefined,
        },
      })
      .catch((err) => console.error("event log write failed:", err));
  });
  next();
}

// Deletes entries past EVENT_LOG_DAYS: once at start-up, then every 6 hours.
// (The admin page also filters by age, so what it shows is exact in between.)
export function startEventLogPruning() {
  const run = () =>
    prisma.eventLog
      .deleteMany({ where: { at: { lt: new Date(Date.now() - EVENT_LOG_DAYS * DAY_MS) } } })
      .then(({ count }) => count && console.log(`[eventlog] deleted ${count} entries older than ${EVENT_LOG_DAYS} days`))
      .catch((err) => console.error("event log prune failed:", err));
  run();
  setInterval(run, 6 * 60 * 60 * 1000);
}
