import { createLogger, format, transports } from 'winston';
import path from 'path';

const logDir = process.env['LOG_DIR'] ?? 'logs';

const logger = createLogger({
  level: process.env['LOG_LEVEL'] ?? 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
    }),
    new transports.File({
      filename: path.join(logDir, 'combined.log'),
    }),
  ],
});

// Always log to console so fly logs captures output in all environments
logger.add(
  new transports.Console({
    format: process.env['NODE_ENV'] === 'production'
      ? format.combine(format.timestamp(), format.json())
      : format.combine(format.colorize(), format.simple()),
  })
);

export default logger;
