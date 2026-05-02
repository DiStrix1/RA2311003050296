const MAX_DECIMAL_PLACES = 3;
const FLOAT_TOLERANCE = 1e-9;

function getDecimalPlaces(value) {
  const textValue = String(value);

  if (textValue.includes('e-')) {
    return Number(textValue.split('e-')[1]);
  }

  const decimalPart = textValue.split('.')[1];
  return decimalPart ? decimalPart.length : 0;
}

function getScaleFactor(values) {
  const maxDecimalPlaces = values.reduce((max, value) => {
    return Math.max(max, getDecimalPlaces(value));
  }, 0);

  if (maxDecimalPlaces > MAX_DECIMAL_PLACES) {
    throw new Error(`Durations support up to ${MAX_DECIMAL_PLACES} decimal places`);
  }

  return 10 ** maxDecimalPlaces;
}

function roundMetric(value) {
  return Number(value.toFixed(MAX_DECIMAL_PLACES));
}

function normalizeItems(vehicles, mechanicHours) {
  if (!Array.isArray(vehicles)) {
    throw new Error('Vehicles must be an array');
  }

  if (!Number.isFinite(mechanicHours) || mechanicHours < 0) {
    throw new Error('Mechanic hours must be a non-negative number');
  }

  const durations = vehicles.map((vehicle) => vehicle.duration);
  const scaleFactor = getScaleFactor([mechanicHours, ...durations]);
  const capacity = Math.floor(mechanicHours * scaleFactor + FLOAT_TOLERANCE);

  const items = vehicles.map((vehicle) => {
    if (vehicle.taskId === undefined || vehicle.taskId === null) {
      throw new Error('Vehicle taskId is required');
    }

    if (!Number.isFinite(vehicle.duration) || vehicle.duration < 0) {
      throw new Error(`Vehicle ${vehicle.taskId} has an invalid duration`);
    }

    if (!Number.isFinite(vehicle.impact) || vehicle.impact < 0) {
      throw new Error(`Vehicle ${vehicle.taskId} has an invalid impact`);
    }

    return {
      taskId: vehicle.taskId,
      duration: vehicle.duration,
      impact: vehicle.impact,
      durationUnits: Math.round(vehicle.duration * scaleFactor)
    };
  });

  return { items, capacity };
}

function solveKnapsack(vehicles, mechanicHours) {
  const { items, capacity } = normalizeItems(vehicles, mechanicHours);
  const itemCount = items.length;

  const dp = Array.from({ length: itemCount + 1 }, () => {
    return Array(capacity + 1).fill(0);
  });

  for (let itemIndex = 1; itemIndex <= itemCount; itemIndex += 1) {
    const item = items[itemIndex - 1];

    for (let currentCapacity = 0; currentCapacity <= capacity; currentCapacity += 1) {
      const excludedImpact = dp[itemIndex - 1][currentCapacity];

      if (item.durationUnits > currentCapacity) {
        dp[itemIndex][currentCapacity] = excludedImpact;
        continue;
      }

      const includedImpact =
        item.impact + dp[itemIndex - 1][currentCapacity - item.durationUnits];

      dp[itemIndex][currentCapacity] =
        includedImpact > excludedImpact ? includedImpact : excludedImpact;
    }
  }

  const selectedItems = [];
  let remainingCapacity = capacity;

  for (let itemIndex = itemCount; itemIndex > 0; itemIndex -= 1) {
    const item = items[itemIndex - 1];
    const currentImpact = dp[itemIndex][remainingCapacity];
    const previousImpact = dp[itemIndex - 1][remainingCapacity];

    if (Math.abs(currentImpact - previousImpact) > FLOAT_TOLERANCE) {
      selectedItems.push(item);
      remainingCapacity -= item.durationUnits;
    }
  }

  selectedItems.reverse();

  return {
    selectedTasks: selectedItems.map((item) => item.taskId),
    totalDuration: roundMetric(
      selectedItems.reduce((sum, item) => sum + item.duration, 0)
    ),
    totalImpact: roundMetric(
      selectedItems.reduce((sum, item) => sum + item.impact, 0)
    )
  };
}

module.exports = {
  solveKnapsack
};
