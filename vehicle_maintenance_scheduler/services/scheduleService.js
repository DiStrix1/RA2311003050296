const axios = require('axios');
const { evaluationService } = require('../config/apiConfig');
const logger = require('../config/logger');
const { solveKnapsack } = require('../utils/knapsack');

const evaluationClient = axios.create({
  baseURL: evaluationService.baseURL,
  timeout: evaluationService.timeoutMs
});

function createPublicError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}

function getAuthHeaders() {
  const token = evaluationService.getAuthToken();

  if (!token) {
    throw createPublicError('Evaluation service auth token is not configured');
  }

  return {
    Authorization: `Bearer ${token}`
  };
}

function extractCollection(payload, keys) {
  if (Array.isArray(payload)) {
    return payload;
  }

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  if (payload?.data && payload.data !== payload) {
    return extractCollection(payload.data, keys);
  }

  throw createPublicError(`Evaluation service returned an invalid ${keys[0]} payload`);
}

function normalizeDepots(payload) {
  return extractCollection(payload, ['depots']).map((depot, index) => {
    const depotId = depot.ID ?? depot.id ?? depot.depotId;
    const mechanicHours = Number(depot.MechanicHours ?? depot.mechanicHours);

    if (depotId === undefined || depotId === null) {
      throw createPublicError(`Depot at index ${index} is missing ID`);
    }

    if (!Number.isFinite(mechanicHours) || mechanicHours < 0) {
      throw createPublicError(`Depot ${depotId} has invalid MechanicHours`);
    }

    return {
      depotId,
      mechanicHours
    };
  });
}

function normalizeVehicles(payload) {
  return extractCollection(payload, ['vehicles']).map((vehicle, index) => {
    const taskId = vehicle.TaskID ?? vehicle.taskId ?? vehicle.id;
    const duration = Number(vehicle.Duration ?? vehicle.duration);
    const impact = Number(vehicle.Impact ?? vehicle.impact);

    if (taskId === undefined || taskId === null) {
      throw createPublicError(`Vehicle at index ${index} is missing TaskID`);
    }

    if (!Number.isFinite(duration) || duration < 0) {
      throw createPublicError(`Vehicle ${taskId} has invalid Duration`);
    }

    if (!Number.isFinite(impact) || impact < 0) {
      throw createPublicError(`Vehicle ${taskId} has invalid Impact`);
    }

    return {
      taskId,
      duration,
      impact
    };
  });
}

async function fetchEvaluationData(path, resourceName, headers) {
  try {
    const response = await evaluationClient.get(path, {
      headers
    });

    return response.data;
  } catch (error) {
    await logger.error(
      'service',
      `Fetch ${resourceName} failed`
    );

    throw createPublicError(`Unable to fetch ${resourceName} from evaluation service`);
  }
}

async function createMaintenanceSchedule() {
  await logger.info('service', 'Fetching depots vehicles');

  const authHeaders = getAuthHeaders();

  const [depotsPayload, vehiclesPayload] = await Promise.all([
    fetchEvaluationData(evaluationService.depotsPath, 'depots', authHeaders),
    fetchEvaluationData(evaluationService.vehiclesPath, 'vehicles', authHeaders)
  ]);

  const depots = normalizeDepots(depotsPayload);
  const vehicles = normalizeVehicles(vehiclesPayload);

  await logger.info(
    'service',
    `Fetched depots=${depots.length} vehicles=${vehicles.length}`
  );

  const depotSchedules = depots.map((depot) => {
    const schedule = solveKnapsack(vehicles, depot.mechanicHours);

    return {
      depotId: depot.depotId,
      selectedTasks: schedule.selectedTasks,
      totalDuration: schedule.totalDuration,
      totalImpact: schedule.totalImpact
    };
  });

  await logger.info('service', `Created schedules for depots=${depotSchedules.length}`);

  return {
    depots: depotSchedules
  };
}

module.exports = {
  createMaintenanceSchedule
};
