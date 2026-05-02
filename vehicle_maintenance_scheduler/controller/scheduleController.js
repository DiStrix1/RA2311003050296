const scheduleService = require('../services/scheduleService');
const logger = require('../config/logger');

function getRequestId(req) {
  return req.headers['x-request-id'] || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function getSchedule(req, res, next) {
  const requestId = getRequestId(req);

  try {
    await logger.info('controller', 'Schedule request started');

    const schedule = await scheduleService.createMaintenanceSchedule();

    await logger.info(
      'controller',
      `Schedule completed depots=${schedule.depots.length}`
    );

    return res.status(200).json(schedule);
  } catch (error) {
    await logger.error(
      'controller',
      `Schedule failed requestId=${requestId}`
    );

    return next(error);
  }
}

module.exports = {
  getSchedule
};
