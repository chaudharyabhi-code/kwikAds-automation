import winston from 'winston';

const { combine, timestamp, colorize, printf } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts }) => {
  return `[${ts}] ${level}: ${message}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: combine(
    colorize(),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat,
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: 'reports/automation.log',
      format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
    }),
  ],
});
