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
