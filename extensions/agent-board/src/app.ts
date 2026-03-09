import express from "express";
import path from "node:path";

import apiRouter from "./routes.js";

export function createAgentBoardApp(params: { dashboardDir: string }) {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use("/api", apiRouter);
  app.use(express.static(params.dashboardDir));

  app.get("/client/:projectId", (_req, res) => {
    res.sendFile(path.join(params.dashboardDir, "client.html"));
  });

  app.get("/", (_req, res) => {
    res.sendFile(path.join(params.dashboardDir, "index.html"));
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.stack || err.message || "Internal server error" });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
