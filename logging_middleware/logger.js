const axios = require('axios');

const VALID_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];

const VALID_PACKAGES = [
  'controller',
  'service',
  'repository',
  'handler',
  'route',
  'db',
  'domain',
  'cache',
  'cron_job'
];

const MAX_MESSAGE_LENGTH = 48;

function normalizeMessage(message) {
  const text = String(message ?? '');
  return text.length <= MAX_MESSAGE_LENGTH
    ? text
    : text.slice(0, MAX_MESSAGE_LENGTH);
}

class Logger {
  constructor(baseURL, getToken, options = {}) {
    this.baseURL = baseURL;
    this.getToken = getToken;
    this.timeout = options.timeout || 5000;
  }

  async log(level, pkg, message) {
    try {
      if (!VALID_LEVELS.includes(level)) return;
      if (!VALID_PACKAGES.includes(pkg)) return;

      const token = this.getToken();
      if (!token) {
        process.stderr.write('Logger Error: Missing auth token\n');
        return;
      }

      const logEntry = {
        stack: 'backend',
        level,
        package: pkg,
        message: normalizeMessage(message),
        timestamp: new Date().toISOString()
      };

      const res = await axios.post(
        `${this.baseURL}/evaluation-service/logs`,
        logEntry,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: this.timeout
        }
      );

      return res.data;
    } catch (err) {
      const details = err.response?.data || err.message;
      const message = typeof details === 'string'
        ? details
        : JSON.stringify(details);

      process.stderr.write(`Logging failed: ${message}\n`);
    }
  }

  debug(pkg, msg) {
    return this.log('debug', pkg, msg);
  }

  info(pkg, msg) {
    return this.log('info', pkg, msg);
  }

  warn(pkg, msg) {
    return this.log('warn', pkg, msg);
  }

  error(pkg, msg) {
    return this.log('error', pkg, msg);
  }

  fatal(pkg, msg) {
    return this.log('fatal', pkg, msg);
  }
}

module.exports = Logger;
