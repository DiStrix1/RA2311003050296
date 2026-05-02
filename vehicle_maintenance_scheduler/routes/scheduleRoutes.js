const express = require('express');
const scheduleController = require('../controller/scheduleController');
const logger = require('../config/logger');

const router = express.Router();

function logRouteAccess(req, _res, next) {
  void logger.info('route', `Route ${req.method} ${req.path}`);
  next();
}

router.get('/schedule', logRouteAccess, scheduleController.getSchedule);

module.exports = router;
