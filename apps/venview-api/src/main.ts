import express from 'express';
import cors from 'cors';
import http from 'http';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { typeDefs } from './schema/typeDefs.js';
import { resolvers } from './schema/resolvers/index.js';
import { createContext } from './context/index.js';
import healthRouter from './routes/health.js';
import posRouter from './routes/pos.js';
import uploadsRouter from './routes/uploads.js';
import billingRouter from './routes/billing.js';
import waitlistRouter from './routes/waitlist.js';
import logger from './lib/logger.js';

const host = process.env['HOST'] ?? '0.0.0.0';
const port = process.env['PORT'] ? Number(process.env['PORT']) : 8080;

const clientOrigin = process.env['CLIENT_URL'] ?? 'http://localhost:4200';
const superAdminOrigin = process.env['SUPER_ADMIN_URL'] ?? 'http://localhost:4202';
const marketingOrigin = process.env['MARKETING_URL'] ?? 'http://localhost:4321';

const allowedOrigins = [
  clientOrigin,
  superAdminOrigin,
  marketingOrigin,
  'https://studio.apollographql.com',
  'https://venview.io',
  'https://www.venview.io',
  'https://venview-client.vercel.app',
];

async function main() {
  const app = express();
  const httpServer = http.createServer(app);

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
    introspection: true,
  });

  await server.start();

  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );

  // Stripe webhook needs the raw, unparsed body for signature verification —
  // register it before the global JSON parser.
  app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

  app.use(express.json());

  // HTTP request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info('http', {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
        ip: req.ip,
      });
    });
    next();
  });

  // REST routes
  app.use('/api', healthRouter);
  app.use('/api', posRouter);
  app.use('/api', uploadsRouter);
  app.use('/api', billingRouter);
  app.use('/api', waitlistRouter);

  // GraphQL endpoint
  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: ({ req }) => createContext(req),
    })
  );

  httpServer.listen({ port, host }, () => {
    logger.info(`server ready at http://${host}:${port}/graphql`);
  });
}

main().catch((err) => {
  logger.error('Failed to start server', { error: err });
  process.exit(1);
});
