const pino = require('pino');

function getMinLevel() {
  const v = String(process.env.TRACEL_LOG_LEVEL || process.env.LOG_LEVEL || 'info').trim().toLowerCase();
  if (['debug', 'info', 'warn', 'error'].includes(v)) return v;
  return 'info';
}

const isDev = process.env.NODE_ENV !== 'production';

const pinoOptions = {
  level: getMinLevel(),
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  redact: {
    paths: [
      'password',
      'token',
      'authorization',
      'req.headers.authorization',
      'cookie',
      'req.headers.cookie'
    ],
    censor: '[REDACTED]'
  }
};

let transport;
if (isDev) {
  transport = pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  });
}

const pinoLogger = isDev ? pino(pinoOptions, transport) : pino(pinoOptions);

// Keep the old API signature intact for backward compatibility:
// log.info('message', { meta: 'data' })
// Note: Pino prefers log.info({ meta: 'data' }, 'message'), but we wrap it to support old usages gracefully
// if we can't change all call sites. Or we can just export pino directly if call sites are compatible.
// But to be safe and drop-in, we'll wrap it:
const log = {
  debug: (...args) => wrapLog('debug', ...args),
  info: (...args) => wrapLog('info', ...args),
  warn: (...args) => wrapLog('warn', ...args),
  error: (...args) => wrapLog('error', ...args),
  child: (bindings) => pinoLogger.child(bindings)
};

function wrapLog(level, ...args) {
  if (args.length === 0) return;
  if (args.length === 1) {
    pinoLogger[level](args[0]);
    return;
  }
  
  // If first arg is string and second is object, swap them for pino format
  const first = args[0];
  const second = args[1];
  
  if (typeof first === 'string' && typeof second === 'object' && second !== null) {
    pinoLogger[level](second, first, ...args.slice(2));
  } else if (typeof first === 'object' && first !== null && typeof second === 'string') {
    pinoLogger[level](first, second, ...args.slice(2));
  } else {
    // Just pass as is
    pinoLogger[level](...args);
  }
}

module.exports = log;
