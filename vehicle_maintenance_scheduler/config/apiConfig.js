const fs = require('fs');
const path = require('path');

const DEFAULT_EVALUATION_BASE_URL = 'http://20.207.122.201';
const DEFAULT_PORT = 3000;
const DEFAULT_TIMEOUT_MS = 10000;

const localTokenFile = path.resolve(__dirname, '..', '..', 'dcve');

function readTokenFile(filePath) {
  if (!filePath) return null;

  try {
    const token = fs.readFileSync(path.resolve(filePath), 'utf8').trim();
    return token || null;
  } catch (_error) {
    return null;
  }
}

function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getAuthToken() {
  return (
    process.env.EVALUATION_AUTH_TOKEN ||
    process.env.AUTH_TOKEN ||
    readTokenFile(process.env.EVALUATION_TOKEN_FILE) ||
    readTokenFile(localTokenFile)
  );
}

module.exports = {
  port: readNumber(process.env.PORT, DEFAULT_PORT),
  evaluationService: {
    baseURL: process.env.EVALUATION_BASE_URL || DEFAULT_EVALUATION_BASE_URL,
    depotsPath: '/evaluation-service/depots',
    vehiclesPath: '/evaluation-service/vehicles',
    timeoutMs: readNumber(process.env.EVALUATION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    getAuthToken
  }
};
