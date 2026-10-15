// Must be imported before any routes are registered. Express 4 has no
// built-in way to notice when an async route handler's returned promise
// rejects - a thrown error inside one becomes an unhandled promise
// rejection, which crashes the entire Node process by default (not just
// that one request) rather than reaching the error-handling middleware
// below. This patches Express so those rejections correctly flow into
// next(err) instead, the same as a synchronous throw always has.
import "express-async-errors";
import express from "express";
import path from "path";
import cors from "cors";
import { env } from "./env";
import { authRouter } from "./routes/auth";
import { meRouter } from "./routes/me";
import { adminRouter } from "./routes/admin";
import { cashierRouter } from "./routes/cashier";

// Last-resort safety net for anything that still manages to reject outside
// of a request entirely (e.g. background code, not caught by the line
// above since that only patches Express's own handler dispatch) - log and
// keep the process alive rather than taking down the whole API for every
// employee over one bad request/error.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

const app = express();
// Caddy runs on this same machine and sets X-Forwarded-For - trust it (and
// only it) so req.ip is the real client address, which the cashier login
// throttle keys on. Without this every request would look like 127.0.0.1.
app.set("trust proxy", "loopback");
app.use(cors());
// Default 100kb is too small for a reconciliation upload - the browser
// parses Digitory's CSV client-side and posts up to 5000 rows as JSON,
// which can run a few hundred KB depending on column widths.
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/api/me", meRouter);
app.use("/api/admin", adminRouter);
app.use("/api/cashier", cashierRouter);

// Static admin dashboard - a plain HTML/CSS/JS page (no build step) served
// straight from this same server. Reachable from any browser, phone or
// desktop, at http://<server-address>:4000/admin
app.use("/admin", express.static(path.join(__dirname, "..", "public", "admin")));

// Static cashier screen - same approach, at /cashier. Meant to stay open on
// a tablet at the till; see public/cashier/app.js.
app.use("/cashier", express.static(path.join(__dirname, "..", "public", "cashier")));

// The employee-facing PWA - the Expo web export (`npx expo export --platform
// web` in mobile/, copied here as public/app), served at the site root, same
// origin as the API so the mobile client's EXPO_PUBLIC_API_URL can just be
// empty/relative. Falls back to index.html for any path that isn't a real
// static file, since expo-router's client-side routes (e.g. /history) only
// exist in the JS bundle, not as files on disk - a hard refresh on one of
// those needs index.html to load so the router can take over.
const webAppDir = path.join(__dirname, "..", "public", "app");
app.use(express.static(webAppDir));
app.get(/^(?!\/(auth|api|admin|cashier|health)(\/|$)).*/, (_req, res) => {
  res.sendFile(path.join(webAppDir, "index.html"));
});

// Central error handler - keep 4xx thrown as-is upstream, this is a catch-all.
app.use(
  (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  }
);

app.listen(env.port, () => {
  console.log(`TOIT benefits API listening on :${env.port}`);
});
