import express from "express";
import path from "path";
import cors from "cors";
import { env } from "./env";
import { authRouter } from "./routes/auth";
import { meRouter } from "./routes/me";
import { adminRouter } from "./routes/admin";

const app = express();
app.use(cors());
// Default 100kb is too small for a reconciliation upload - the browser
// parses Digitory's CSV client-side and posts up to 5000 rows as JSON,
// which can run a few hundred KB depending on column widths.
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/api/me", meRouter);
app.use("/api/admin", adminRouter);

// Static admin dashboard - a plain HTML/CSS/JS page (no build step) served
// straight from this same server. Reachable from any browser, phone or
// desktop, at http://<server-address>:4000/admin
app.use("/admin", express.static(path.join(__dirname, "..", "public", "admin")));

// The employee-facing PWA - the Expo web export (`npx expo export --platform
// web` in mobile/, copied here as public/app), served at the site root, same
// origin as the API so the mobile client's EXPO_PUBLIC_API_URL can just be
// empty/relative. Falls back to index.html for any path that isn't a real
// static file, since expo-router's client-side routes (e.g. /history) only
// exist in the JS bundle, not as files on disk - a hard refresh on one of
// those needs index.html to load so the router can take over.
const webAppDir = path.join(__dirname, "..", "public", "app");
app.use(express.static(webAppDir));
app.get(/^(?!\/(auth|api|admin|health)(\/|$)).*/, (_req, res) => {
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
