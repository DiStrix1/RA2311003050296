const express = require('express');
const scheduleRoutes = require('./routes/scheduleRoutes');
const logger = require('./config/logger');
const { port } = require('./config/apiConfig');

const app = express();

app.disable('x-powered-by');
app.use(express.json());
app.use(scheduleRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl
  });
});

app.use(async (error, req, res, _next) => {
  await logger.error(
    'handler',
    'Request handler error'
  );

  const statusCode = error.statusCode || 500;

  res.status(statusCode).json({
    error: error.publicMessage || 'Internal server error'
  });
});

if (require.main === module) {
  app.listen(port, () => {
    void logger.info(
      'handler',
      `Scheduler started port=${port}`
    );
  });
}

module.exports = app;
