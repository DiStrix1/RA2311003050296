# Vehicle Maintenance Scheduler

Backend microservice for building depot maintenance schedules from the provided
evaluation APIs.

## Structure

- `app.js`: Express setup, route mounting, and error handling.
- `routes/`: HTTP route definitions and route-level logging.
- `controller/`: Request/response handling.
- `services/`: Evaluation API calls and scheduling orchestration.
- `utils/`: Pure knapsack implementation.
- `config/`: API, auth, and logger configuration.

## Run

```powershell
$env:EVALUATION_AUTH_TOKEN = "<token>"
npm start
```

The default evaluation API base URL is `http://20.207.122.201`. If your
assignment portal gives you a different host, override it before starting:

```powershell
$env:EVALUATION_BASE_URL = "http://your-evaluation-host"
npm start
```

Then call:

```text
GET http://localhost:3000/schedule
```

You can also provide a token file:

```powershell
$env:EVALUATION_TOKEN_FILE = "D:\path\to\token.txt"
npm start
```

If neither environment variable is set, the app will try a local `dcve` file in
the repository root.
