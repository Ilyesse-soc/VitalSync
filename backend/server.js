const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { Pool } = require('pg');
const client = require('prom-client');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return value;
}

function buildPoolFromEnv() {
  if (!process.env.DB_HOST) {
    return null;
  }

  return new Pool({
    host: requiredEnv('DB_HOST'),
    port: Number(process.env.DB_PORT || 5432),
    database: requiredEnv('DB_NAME'),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD')
  });
}

function buildApp({ pool } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));
  app.use(morgan('combined'));

  const startedAt = Date.now();

  // --- Monitoring Prometheus
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const httpDurationSeconds = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Durée des requêtes HTTP en secondes',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry]
  });

  app.use((req, res, next) => {
    const end = httpDurationSeconds.startTimer();

    res.on('finish', () => {
      const route = req.route?.path || req.path || 'unknown';
      end({
        method: req.method,
        route,
        status_code: String(res.statusCode)
      });
    });

    next();
  });

  const healthPayload = () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
  });

  // Healthchecks
  app.get('/health', (req, res) => {
    res.json({ status: 'updated' });
  });

  // Même healthcheck derrière le proxy Nginx (/api -> backend)
  app.get('/api/health', (req, res) => {
    res.status(200).json(healthPayload());
  });

  // Exemple d'endpoint qui valide la connectivité PostgreSQL
  app.get('/api/db-check', async (req, res, next) => {
    try {
      if (!pool) {
        return res.status(503).json({ status: 'ko', reason: 'DB non configurée' });
      }

      await pool.query('SELECT 1');
      return res.status(200).json({ status: 'ok' });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/test1', (req, res) => {
    res.json({ message: 'test1' });
  });

  // Endpoint Prometheus (scrape)
  app.get('/metrics', async (req, res, next) => {
    try {
      res.set('Content-Type', registry.contentType);
      res.status(200).send(await registry.metrics());
    } catch (error) {
      next(error);
    }
  });

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Gestion d'erreur centralisée
  app.use((error, req, res, next) => {
    // next est requis par Express pour détecter un middleware d'erreur
    // eslint-disable-next-line no-unused-vars
    const _next = next;

    const isProd = process.env.NODE_ENV === 'production';
    const statusCode = 500;

    res.status(statusCode).json({
      error: 'Internal Server Error',
      message: isProd ? undefined : error.message
    });
  });

  return app;
}

async function start() {
  const port = Number(process.env.PORT || 3000);
  const pool = buildPoolFromEnv();
  const app = buildApp({ pool });

  const server = app.listen(port, () => {
    // log minimal (utile en prod/CI)
    // eslint-disable-next-line no-console
    console.log(`VitalSync backend listening on port ${port}`);
  });

  const shutdown = async (signal) => {
    // eslint-disable-next-line no-console
    console.log(`Received ${signal}, shutting down...`);

    await new Promise((resolve) => server.close(resolve));
    if (pool) {
      await pool.end();
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}

module.exports = { buildApp };
