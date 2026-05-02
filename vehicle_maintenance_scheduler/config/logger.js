const Logger = require('../../logging_middleware/logger');
const { evaluationService } = require('./apiConfig');

const logger = new Logger(
  evaluationService.baseURL,
  evaluationService.getAuthToken,
  { timeout: evaluationService.timeoutMs }
);

module.exports = logger;
