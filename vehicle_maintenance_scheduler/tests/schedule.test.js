const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const axios = require('axios');
const { solveKnapsack } = require('../utils/knapsack');

const originalAxiosCreate = axios.create;
const originalAxiosPost = axios.post;

function clearSchedulerModuleCache() {
  [
    '../app',
    '../routes/scheduleRoutes',
    '../controller/scheduleController',
    '../services/scheduleService',
    '../config/logger',
    '../config/apiConfig'
  ].forEach((modulePath) => {
    delete require.cache[require.resolve(modulePath)];
  });
}

function createMockEvaluationClient(fixtures) {
  return {
    async get(path, config = {}) {
      assert.equal(config.headers.Authorization, 'Bearer test-token');

      if (!fixtures[path]) {
        const error = new Error(`Unexpected path: ${path}`);
        error.response = { status: 404, data: { message: 'not found' } };
        throw error;
      }

      return {
        data: fixtures[path]
      };
    }
  };
}

async function request(app, path) {
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await response.json();

    return {
      statusCode: response.status,
      body
    };
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

test.afterEach(() => {
  axios.create = originalAxiosCreate;
  axios.post = originalAxiosPost;
  delete process.env.EVALUATION_AUTH_TOKEN;
  clearSchedulerModuleCache();
});

test('solveKnapsack selects the highest impact tasks within mechanic hours', () => {
  const result = solveKnapsack(
    [
      { taskId: 'T1', duration: 2, impact: 6 },
      { taskId: 'T2', duration: 3, impact: 10 },
      { taskId: 'T3', duration: 1, impact: 3 }
    ],
    3
  );

  assert.deepEqual(result, {
    selectedTasks: ['T2'],
    totalDuration: 3,
    totalImpact: 10
  });
});

test('GET /schedule returns optimized schedules for every depot', async () => {
  process.env.EVALUATION_AUTH_TOKEN = 'test-token';

  const logEntries = [];

  axios.create = () => createMockEvaluationClient({
    '/evaluation-service/depots': {
      depots: [
        { ID: 'D1', MechanicHours: 3 },
        { ID: 'D2', MechanicHours: 5 }
      ]
    },
    '/evaluation-service/vehicles': {
      vehicles: [
        { TaskID: 'T1', Duration: 2, Impact: 6 },
        { TaskID: 'T2', Duration: 3, Impact: 10 },
        { TaskID: 'T3', Duration: 1, Impact: 3 }
      ]
    }
  });

  axios.post = async (_url, payload) => {
    logEntries.push(payload);
    return { data: { ok: true } };
  };

  clearSchedulerModuleCache();
  const app = require('../app');

  const response = await request(app, '/schedule');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    depots: [
      {
        depotId: 'D1',
        selectedTasks: ['T2'],
        totalDuration: 3,
        totalImpact: 10
      },
      {
        depotId: 'D2',
        selectedTasks: ['T1', 'T2'],
        totalDuration: 5,
        totalImpact: 16
      }
    ]
  });

  assert.ok(logEntries.length >= 3);
  assert.ok(logEntries.every((entry) => entry.stack === 'backend'));
  assert.ok(logEntries.every((entry) => entry.message.length <= 48));
});

test('GET /schedule returns a clear error when auth token is missing', async () => {
  const originalStderrWrite = process.stderr.write;

  axios.create = () => createMockEvaluationClient({});
  axios.post = async () => ({ data: { ok: true } });

  process.stderr.write = () => true;

  try {
    clearSchedulerModuleCache();
    const app = require('../app');

    const response = await request(app, '/schedule');

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
      error: 'Evaluation service auth token is not configured'
    });
  } finally {
    process.stderr.write = originalStderrWrite;
  }
});
