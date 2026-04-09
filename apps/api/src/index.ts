import 'dotenv/config';
import type { Server } from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { senkoConfig } from '@senko/shared';
import { searchHandler, suggestHandler } from './controllers/searchController.js';
import { startCrawlHandler, crawlStatusHandler } from './controllers/crawlController.js';
import { statsHandler } from './controllers/statsController.js';
import { trendingHandler } from './controllers/trendingController.js';
import type { ApiErrorBody } from '@senko/shared';
import { PageRank, schedulePageRank } from '@senko/indexer';

const app = express();
const started = Date.now();

app.use(
  cors({
    origin: [senkoConfig.api.corsOrigin, /^https?:\/\/localhost(:\d+)?$/],
    credentials: true,
  }),
);
app.use(helmet());
app.use(morgan('combined'));
app.use(express.json());

const searchLimiter = rateLimit({
  windowMs: senkoConfig.api.rateLimitWindowMs,
  max: 60,
});
const crawlLimiter = rateLimit({
  windowMs: senkoConfig.api.rateLimitWindowMs,
  max: 10,
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.floor((Date.now() - started) / 1000) });
});

app.get('/api/stats', statsHandler);
app.get('/api/trending', trendingHandler);

app.get('/api/search', searchLimiter, searchHandler);
app.get('/api/suggest', searchLimiter, suggestHandler);

app.post('/api/crawl', crawlLimiter, startCrawlHandler);
app.get('/api/crawl/:jobId/status', crawlStatusHandler);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const body: ApiErrorBody = {
    error: err instanceof Error ? err.message : 'Internal Server Error',
    code: 'INTERNAL',
  };
  res.status(500).json(body);
});

const pr = new PageRank();
schedulePageRank(pr);

let server: Server | null = null;
let shuttingDown = false;

function shutdown(exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;

  if (!server) {
    process.exit(exitCode);
    return;
  }

  server.close((error) => {
    if (error) {
      console.error('[senko] Error while closing API server', error);
      process.exit(1);
      return;
    }
    process.exit(exitCode);
  });

  setTimeout(() => {
    process.exit(exitCode === 0 ? 1 : exitCode);
  }, 5000).unref();
}

server = app.listen(senkoConfig.api.port, () => {
  console.log(`Senko API listening on ${senkoConfig.api.port}`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `[senko] Port ${senkoConfig.api.port} is already in use. The dev startup guard should normally clean this up, but another process is still holding the port.`,
    );
    process.exit(1);
    return;
  }
  console.error('[senko] API server error', error);
  process.exit(1);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
