function normalizeLevel(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v;
  return 'info';
}

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getMinLevel() {
  return normalizeLevel(process.env.TRACEL_LOG_LEVEL || process.env.LOG_LEVEL || 'info');
}

function shouldLog(level) {
  const min = getMinLevel();
  return LEVELS[level] >= LEVELS[min];
}

function stamp() {
  return new Date().toISOString();
}

function write(method, level, args) {
  if (!shouldLog(level)) return;
  // Keep output single-line where possible; let console format objects.
  method(`[${stamp()}] [${level.toUpperCase()}]`, ...args);
}

const log = {
  debug: (...args) => write(console.debug ? console.debug : console.log, 'debug', args),
  info: (...args) => write(console.info ? console.info : console.log, 'info', args),
  warn: (...args) => write(console.warn ? console.warn : console.log, 'warn', args),
  error: (...args) => write(console.error ? console.error : console.log, 'error', args),
};

module.exports = log;
