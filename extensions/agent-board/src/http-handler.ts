import type express from "express";
import type { IncomingMessage, ServerResponse } from "node:http";

export function createAgentBoardHttpHandler(params: {
  app: express.Express;
  basePath: string;
}) {
  const normalizedBasePath = params.basePath === "/" ? "/" : params.basePath.replace(/\/$/, "");

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const matchesBase = pathname === normalizedBasePath || pathname.startsWith(`${normalizedBasePath}/`);
    if (!matchesBase) return false;

    const originalUrl = req.url;
    const strippedPath = pathname.slice(normalizedBasePath.length) || "/";
    req.url = `${strippedPath}${url.search}`;

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
          res.off("finish", onFinish);
          res.off("close", onClose);
        };

        const finish = (err?: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (err) reject(err);
          else resolve();
        };

        const onFinish = () => finish();
        const onClose = () => finish();

        res.once("finish", onFinish);
        res.once("close", onClose);

        try {
          params.app(req as express.Request, res as express.Response, (err?: unknown) => {
            if (err) {
              finish(err);
              return;
            }
            if (res.writableEnded || res.headersSent) {
              finish();
              return;
            }
            finish();
          });
        } catch (err) {
          finish(err);
        }
      });
      return true;
    } finally {
      req.url = originalUrl;
    }
  };
}
