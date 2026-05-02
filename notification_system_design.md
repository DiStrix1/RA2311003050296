# Stage 1 — API Design

## Core Actions

| # | Action | Description |
|---|--------|-------------|
| 1 | Create Notification | Post a new notification to students |
| 2 | Fetch Notifications | Retrieve notifications for a student |
| 3 | Mark as Read | Mark a notification as read |
| 4 | Get Unread Count | Get count of unread notifications |
| 5 | Real-time Push | Push notifications to client in real-time |

---

## REST API Endpoints

### 1. Create Notification

- **Method:** POST
- **Route:** `/api/notifications`
- **Headers:**
  ```
  Content-Type: application/json
  Authorization: Bearer <token>
  ```
- **Request JSON:**
  ```json
  {
    "studentIds": ["1042", "1043"],
    "type": "Placement",
    "title": "Campus Placement Drive",
    "message": "Google is visiting campus on Monday."
  }
  ```
- **Response JSON:**
  ```json
  {
    "success": true,
    "notificationId": "notif-uuid-001",
    "sentAt": "2026-05-02T10:00:00Z"
  }
  ```
- **Status Codes:**
  - 201: Created
  - 400: Bad Request
  - 401: Unauthorized

---

### 2. Fetch Notifications

- **Method:** GET
- **Route:** `/api/notifications?studentId={studentId}&page={page}&limit={limit}`
- **Headers:**
  ```
  Content-Type: application/json
  Authorization: Bearer <token>
  ```
- **Response JSON:**
  ```json
  {
    "notifications": [
      {
        "id": "notif-001",
        "type": "Placement",
        "title": "Campus Placement Drive",
        "message": "Google is visiting campus on Monday.",
        "isRead": false,
        "createdAt": "2026-05-02T10:00:00Z"
      }
    ],
    "page": 1,
    "limit": 20,
    "total": 100
  }
  ```
- **Status Codes:**
  - 200: OK
  - 401: Unauthorized

---

### 3. Mark as Read

- **Method:** PUT
- **Route:** `/api/notifications/{notificationId}/read`
- **Headers:**
  ```
  Content-Type: application/json
  Authorization: Bearer <token>
  ```
- **Response JSON:**
  ```json
  {
    "success": true,
    "notificationId": "notif-001",
    "updatedAt": "2026-05-02T10:05:00Z"
  }
  ```
- **Status Codes:**
  - 200: OK
  - 404: Not Found
  - 401: Unauthorized

---

### 4. Get Unread Count

- **Method:** GET
- **Route:** `/api/notifications/unread/count?studentId={studentId}`
- **Headers:**
  ```
  Content-Type: application/json
  Authorization: Bearer <token>
  ```
- **Response JSON:**
  ```json
  {
    "studentId": "1042",
    "unreadCount": 5
  }
  ```
- **Status Codes:**
  - 200: OK
  - 401: Unauthorized

---

## Real-Time Notification Design

### Approach: WebSocket

**Why WebSocket?**
- Full-duplex communication (server → client push)
- Lower overhead than polling
- Supports immediate delivery

### How It Works

1. **Client Connection:** Client initiates WebSocket connection to `ws://server/notifications`
2. **Authentication:** Client sends auth token in connection handshake
3. **Subscription:** Client subscribes to own student ID channel
4. **Server Push:** When new notification is created, server pushes to relevant student's channel
5. **Client Receipt:** Client receives notification payload in real-time
6. **Acknowledgment:** Client sends ACK; server marks as delivered

### WebSocket Message Format

**Server → Client:**
```json
{
  "type": "NEW_NOTIFICATION",
  "payload": {
    "id": "notif-001",
    "type": "Placement",
    "title": "Campus Placement Drive",
    "message": "Google is visiting campus on Monday.",
    "createdAt": "2026-05-02T10:00:00Z"
  }
}
```

**Client → Server (ACK):**
```json
{
  "type": "ACK",
  "notificationId": "notif-001"
}
```

---

## Naming Conventions

| Convention | Rule | Example |
|------------|------|---------|
| Routes | Lowercase, kebab-case | `/api/notifications` |
| JSON Keys | camelCase | `studentId`, `createdAt` |
| HTTP Methods | Standard REST | POST, GET, PUT, DELETE |
| Status Codes | Standard HTTP | 200, 201, 400, 401, 404 |

---

# Stage 2 — Database Design

## Database Choice: PostgreSQL (SQL)

**Justification:**
- **Query Patterns:** Complex filtering on studentId, isRead, type + sorting by createdAt — SQL handles this efficiently with composite indexes
- **Scalability:** Supports table partitioning by date for archiving old data
- **Data Integrity:** ACID compliance ensures notifications are never lost
- **ENUM Support:** PostgreSQL native ENUM type fits notificationType perfectly

MongoDB would require manual application-level filtering; PostgreSQL handles it at DB level with better performance.

---

## Schema Design

### Table: notifications

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique notification ID |
| studentId | VARCHAR(20) | NOT NULL, INDEX | Student identifier |
| notificationType | ENUM('Event', 'Result', 'Placement') | NOT NULL | Type of notification |
| title | VARCHAR(255) | NOT NULL | Notification title |
| message | TEXT | NOT NULL | Notification body |
| isRead | BOOLEAN | DEFAULT FALSE | Read status |
| createdAt | TIMESTAMP | NOT NULL, DEFAULT NOW() | Creation timestamp |
| updatedAt | TIMESTAMP | DEFAULT NOW() | Last update timestamp |

**Composite Indexes:**
- `(studentId, createdAt DESC)` — For fetch queries sorted by time
- `(studentId, isRead)` — For unread count queries
- `(studentId, notificationType, createdAt DESC)` — For filtered fetches

---

## Indexing Strategy

| Index | Purpose | Why Needed |
|-------|---------|-----------|
| `idx_notifications_studentId_created` | Fetch notifications by student sorted by date | Primary read pattern; eliminates full table scan |
| `idx_notifications_studentId_isRead` | Unread count query | Avoids scanning all rows for same student |
| `idx_notifications_studentId_type_created` | Filtered fetch by type | Supports WHERE type = 'Placement' efficiently |
| `idx_notifications_createdAt` | Time-based queries/archiving | Enables partition pruning |

**Why NOT single-column indexes on every column:**
- Wastes storage (each index is a separate B-tree)
- Slows INSERT/UPDATE (multiple indexes to update)
- Memory overhead grows linearly with data

Composite indexes cover actual query patterns.

---

## Scaling Problems

### Problem 1: Slow Queries at Scale
- **Issue:** With 10M+ rows, filtering `studentId + isRead + ORDER BY createdAt` scans index + sorts in memory
- **Symptom:** Query latency increases from 10ms to 500ms+

### Problem 2: Index Overhead
- **Issue:** Each composite index replicates data pointer + column values
- **Symptom:** With 4 indexes, storage is 4x-8x table size

### Problem 3: Hot/Cold Data
- **Issue:** Recent notifications (last 30 days) are accessed 90% of time; old data rarely queried
- **Symptom:** DB memory is filled with unnecessary old index pages

### Problem 4: Write Amplification
- **Issue:** High-frequency notification creation hits all indexes
- **Symptom:** INSERT latency spikes during batch sends

---

## Solutions

### Solution 1: Table Partitioning (by time)
```sql
CREATE TABLE notifications (
    -- columns
) PARTITION BY RANGE (createdAt);

CREATE TABLE notifications_2026_05 PARTITION FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE notifications_2026_04 PARTITION FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
```
- **Benefit:** Old partitions can be archived/.dropped; queries only hit relevant partition
- **Tradeoff:** More complex maintenance;跨-partition queries need routing

### Solution 2: Read Replicas
- **Benefit:** Offload read traffic to replicas; master handles writes only
- **Tradeoff:** Replication lag (stale reads possible)

### Solution 3: Covering Index (Include Columns)
```sql
CREATE INDEX idx_cover ON notifications (studentId, createdAt DESC) INCLUDE (notificationType, title, message, isRead);
```
- **Benefit:** Index alone satisfies query; no table lookup
- **Tradeoff:** Larger index size

### Solution 4: Archive Old Data
- **Benefit:** Smaller active dataset; faster queries
- **Tradeoff:** Historical queries need separate archive store

---

## Queries

### 1. Fetch Notifications (by studentId, isRead, type, sorted by createdAt DESC)

```sql
SELECT id, notificationType, title, message, isRead, createdAt, updatedAt
FROM notifications
WHERE studentId = '1042'
  AND isRead = false
  AND notificationType = 'Placement'
ORDER BY createdAt DESC
LIMIT 20 OFFSET 0;
```

### 2. Mark Notification as Read

```sql
UPDATE notifications
SET isRead = true, updatedAt = NOW()
WHERE id = 'notif-001' AND studentId = '1042';
```

### 3. Get Unread Count

```sql
SELECT COUNT(*) as unreadCount
FROM notifications
WHERE studentId = '1042' AND isRead = false;
```

### 4. Create Notification (single)

```sql
INSERT INTO notifications (id, studentId, notificationType, title, message, isRead, createdAt)
VALUES ('notif-uuid-001', '1042', 'Placement', 'Campus Placement Drive', 'Google is visiting campus on Monday.', false, NOW());
```

### 5. Batch Create Notification

```sql
INSERT INTO notifications (id, studentId, notificationType, title, message, isRead, createdAt)
VALUES 
  ('notif-uuid-001', '1042', 'Placement', 'Campus Placement Drive', 'Google is visiting.', false, NOW()),
  ('notif-uuid-002', '1043', 'Placement', 'Campus Placement Drive', 'Google is visiting.', false, NOW());

---

# Stage 3 — Query Optimization

## Query Analysis

The given query:

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

**What it does:**
- Fetches all unread notifications for student ID 1042
- Sorts by creation timestamp descending (newest first)
- Returns ALL matching rows (no pagination)

**Correctness issue:**
- Uses `studentID` (camelCase) but schema uses `studentId` — would cause column error
- Missing LIMIT — returns unbounded results (performance bug)
- Uses `SELECT *` — fetches unnecessary columns

---

## Why It Is Slow

**Time Complexity: O(n log n)**

Where n = total rows in table (not just matching rows).

### Breakdown:

| Operation | Cost | Explanation |
|-----------|------|-------------|
| Filtering | O(n) | Without proper index on `studentId + isRead`, DB must scan ALL rows |
| Sorting | O(n log n) | Must sort entire result set in memory/disk |
| Table Lookup | O(n) | SELECT * requires fetching all columns from table pages |

### At scale (10M+ rows):
- Full table scan: 10M row accesses
- In-memory sort: Expensive for large result sets
- I/O: Multiple disk seeks for table pages

**Estimated latency:** 500ms-2000ms depending on data volume.

---

## Index Evaluation

### "Add indexes on every column" — This is BAD

**Why it's bad:**

| Problem | Impact |
|---------|--------|
| Write Overhead | INSERT/UPDATE must update ALL indexes — 5x slower writes |
| Storage Bloat | Each index replicates B-tree; disk usage 5x-10x table size |
| Memory Pressure | Index pages compete with table data in buffer pool |
| Diminishing Returns | Many indexes never used by queries |

### Optimal Index Design

**Composite index required:**

```sql
CREATE INDEX idx_notifications_student_isread_created 
ON notifications (studentId, isRead, createdAt DESC);
```

**Column order explained:**

| Position | Column | Why |
|----------|--------|-----|
| 1st | studentId | = equality filter — narrows dataset fastest |
| 2nd | isRead | = equality filter — further narrows |
| 3rd | createdAt DESC | ORDER BY matches — avoids sort |

**Query will use index only if:**
- SELECT specific columns (not SELECT *)
- Add LIMIT

---

## Optimized Solution

### Improved Query:

```sql
SELECT id, notificationType, title, message, isRead, createdAt
FROM notifications
WHERE studentId = '1042' AND isRead = false
ORDER BY createdAt DESC
LIMIT 20;
```

### With Index:

```sql
CREATE INDEX idx_notifications_student_isread_created 
ON notifications (studentId, isRead, createdAt DESC);
```

### Performance Improvement:

| Metric | Before | After |
|--------|--------|-------|
| Scan | Full table (O(n)) | Index range (O(log n + k)) |
| Sort | O(n log n) | Already sorted in index |
| I/O | Many page reads | Few index leaf pages |

**Time Complexity: O(log n + k)** where k = result size (20)

---

## New Query

**Find all students who received "Placement" notifications in the last 7 days:**

```sql
SELECT DISTINCT studentId
FROM notifications
WHERE notificationType = 'Placement'
  AND createdAt >= NOW() - INTERVAL '7 days';
```

**Optimized with index:**

```sql
CREATE INDEX idx_notifications_type_created 
ON notifications (notificationType, createdAt DESC);
```

**Execution Plan:**
1. Index scan on `(notificationType, createdAt)`
2. Filter by date range (7 days)
3. DISTINCT aggregation on studentId

**Time Complexity: O(m log m)** where m = matching rows

---

# Stage 4 — Performance Improvement

## Problem Summary

**Current Issue:**
- Fetching notifications from DB on EVERY page load
- No caching, no pagination, no real-time push
- Result: High DB load, slow response times, poor UX

---

## Caching Strategy

### What to Cache

| Data | Cache Duration | Reason |
|------|-----------------|--------|
| Recent 20 notifications per student | 5 minutes | Frequently accessed, changes slowly |
| Unread count per student | 1 minute | Real-time count important |
| All-time unread list | TTL 1 hour | Changes when user reads |

### Cache Key Design

```
Key: "notifs:{studentId}:recent"
Value: JSON array of latest 20 notifications
TTL: 300 seconds

Key: "notifs:{studentId}:unread_count"
Value: Integer
TTL: 60 seconds
```

### Cache Invalidation Strategy

| Event | Action |
|-------|--------|
| New notification created | Invalidate student's "recent" + update "unread_count" |
| Notification marked read | Invalidate both caches |
| Notification deleted | Invalidate both caches |

**Write-through pattern:**
1. Write to DB first
2. Update/invalidate cache
3. Return success

### How It Reduces DB Load

| Metric | Before | After |
|--------|--------|-------|
| DB hits per page load | 1 | 0 (cache hit) |
| Response time | 200ms | 5ms |
| DB QPS | 1000 | ~50 |

---

## Pagination Strategy

### Why Fetching All Is Bad

- Unbounded result set = unknown memory usage
- Sorting large dataset = O(n log n)
- Network transfer of unnecessary data

### Cursor-Based Pagination (Recommended)

```sql
-- First page
SELECT id, notificationType, title, message, isRead, createdAt
FROM notifications
WHERE studentId = '1042'
ORDER BY createdAt DESC
LIMIT 20;

-- Next page (cursor = last createdAt from previous page)
SELECT id, notificationType, title, message, isRead, createdAt
FROM notifications
WHERE studentId = '1042'
  AND createdAt < '2026-05-02T10:00:00Z'
ORDER BY createdAt DESC
LIMIT 20;
```

**Better than OFFSET:**
- OFFSET causes O(n) scan for large offsets
- Cursor uses index efficiently: O(log n + k)

### Impact

| Approach | Performance | Issue |
|----------|-------------|-------|
| LIMIT/OFFSET | Degrades at high OFFSET | Scans skipped rows |
| Cursor-based | O(log n + k) | Requires passing cursor |

---

## Real-Time Push Design

### Why Polling Is Inefficient

- Client polls every 10 seconds = 10 requests/second for 1000 clients
- Most polls return empty (wasted resources)
- Delay between event and delivery (max 10 seconds)

### WebSocket Architecture

```
Client                        Server                        DB
  |                            |                            |
  |------- WS Connect ------->|                            |
  |<----- Auth OK ------------|                            |
  |                            |                            |
  |                    [New Notification Created]       |
  |                            |<--- Insert to DB ----------|
  |<---- Push Notification ----|                            |
  |---- ACK ----------------->|                            |
```

### Implementation

**Server-side:**
1. Maintain WebSocket connection per student
2. Map studentId → WebSocket connection
3. On INSERT: push to connected client + save to DB

**Client-side:**
1. Connect on page load
2. Listen for NEW_NOTIFICATION events
3. Update local state + UI instantly
4. Send ACK when rendered

**Alternative: Server-Sent Events (SSE)**
- Simpler than WebSocket (one-way)
- Works over HTTP/1.1
- No binary protocol needed

---

## Architecture Improvement

### Layered Approach

```
[Client]
    |
    v
[Cache (Redis)] ----> HIT: return cached data
    |
    v (MISS)
[Database (PostgreSQL)] --> return + write to cache
```

### Flow for Fetch Notifications

1. Check Redis for `notifs:{studentId}:recent`
2. If HIT → return JSON (5ms)
3. If MISS → Query DB with LIMIT 20
4. Write result to cache
5. Return response (200ms)

### Reducing Repeated DB Hits

| Technique | How | Improvement |
|-----------|-----|-------------|
| Caching | Serve from Redis | 95% fewer DB hits |
| Pagination | LIMIT 20 vs all | 50x less data |
| Real-time push | Only new data sent | No poll waste |
| Stale-while-revalidate | Serve stale, update async | No blocking |

---

## Tradeoffs

### Caching

| Pro | Con |
|-----|-----|
| 95% DB load reduction | Cache invalidation complexity |
| Sub-10ms response | Memory cost for Redis |
| Cache may serve stale data | Requires careful TTL |

**When it fails:**
- Cache down → DB spike → cascade failure
- Improper invalidation → user sees old data

### Pagination

| Pro | Con |
|-----|-----|
| Bounded memory | More complex client code |
| Faster queries | Cursor must be valid |
| Predictable load | Deep pagination still slow |

**When it fails:**
- Invalid cursor → query fails
- User scrolls too deep → slow query

### Real-Time Push

| Pro | Con |
|-----|-----|
| Instant delivery | WebSocket management |
| Fewer requests | Connection state |
| Better UX | Reconnection logic |

**When it fails:**
- Connection drops → need reconnect
- Firewalls block WS ports
- Scales poorly with 100K+ connections (needs connection pooler)

### Architecture

| Pro | Con |
|-----|-----|
| Resilient (cache down = fallback) | More components to maintain |
| Scalable (read replicas) | Replication lag possible |
| Layered caching | Data inconsistency window |

**When it fails:**
- Redis down without fallback → DB crash
- Cache stampede (all clients miss → DB flood)

# Stage 5 — Reliability & System Design

## Problems in Current Design

### Code Analysis
```python
def notify_all(student_ids, message):
    for student_id in student_ids:
        send_email(student_id, message)
        save_to_db(student_id, message)
        push_to_app(student_id, message)
```

### Identified Issues

| Problem | Explanation |
|---------|-------------|
| Sequential Execution | One student at a time; 10,000 students = 10,000 iterations |
| Blocking I/O | Each call waits before next iteration |
| No Atomicity | DB save succeeds but email fails = inconsistent |
| No Error Handling | Exception stops entire process |
| No Idempotency | Retries cause duplicate notifications |
| No Rollback | Mid-failure leaves unknown state |

### Failure Scenarios

| Scenario | What Happens |
|----------|--------------|
| Email fails at student 200 | 1-199 done, 200-10000 never processed |
| DB fails at student 200 | Email sent but no DB record |
| Process crashes | No recovery, partial sends |

---

## Redesigned Architecture

### Queue-Based Async Flow
```
[API Server] --> [Queue (Kafka)] --> [Email Worker]
                         --> [DB Worker]
                         --> [Push Worker]
```

### Message Format
```json
{
  "messageId": "msg-uuid-001",
  "studentId": "1042",
  "type": "Placement",
  "title": "Placement Drive",
  "message": "Google visiting Monday",
  "retryCount": 0
}

---

## Failure Handling Strategy

### Retry Mechanism
| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 5 seconds |
| 3 | 30 seconds |
| 4 | 2 minutes |
| 5+ | Move to DLQ |

### Dead Letter Queue (DLQ)
- After max retries, message moved to DLQ
- Alert monitoring system
- Manual review required

---

## Idempotency

### Why Duplicates Occur
- API retried after timeout
- Worker fails after DB write but before ACK
- Message queue redelivers after crash

### Prevention
```sql
INSERT INTO notifications (id, studentId, message)
SELECT 'msg-uuid', '1042', 'Message'
WHERE NOT EXISTS (
    SELECT 1 FROM notifications 
    WHERE idempotencyKey = 'hash-of-message'
);
```

---

## DB vs Email Decision

**Answer: NO — Separate them**

| Aspect | Synchronous | Async |
|-------|-------------|-------|
| Response Time | 83 minutes | < 5ms |
| Reliability | One failure kills all | Isolated failures |
| Scalability | Blocks | Scales |

**Flow:** 1. Save to DB first (source of truth) 2. Publish to queue (async) 3. Return 202

---

## Scalability

| Strategy | Implementation |
|----------|---------------|
| Partitioned Queue | Kafka partitions by studentId |
| Horizontal Workers | Multiple instances |
| Batch Processing | 100 messages per batch |

**Metrics:** 10,000 msg/sec, < 5ms latency

---

## Revised Pseudocode

### Bad (Before)
```python
def notify_all(student_ids, message):
    for student_id in student_ids:
        send_email(student_id, message)
        save_to_db(student_id, message)
        push_to_app(student_id, message)
```

### Good (After)
```python
from kafka import KafkaProducer
import hashlib

def notify_all(student_ids, message):
    idempotency_key = hashlib.sha256(
        f"{message['type']}:{message['title']}:{message['timestamp']}".encode()
    ).hexdigest()
    
    # 1. Save to DB (source of truth)
    for student_id in student_ids:
        db.save_notification(id=idempotency_key, student_id=student_id, 
                           type=message['type'], title=message['title'],
                           message=message['message'])
    
    # 2. Publish to queue (async)
    producer = KafkaProducer(bootstrap_servers='localhost:9092')
    for student_id in student_ids:
        event = {'messageId': idempotency_key, 'studentId': student_id,
                'type': message['type'], 'message': message['message']}
        producer.send('notification_events', event)
    producer.flush()
    return {"status": "accepted", "count": len(student_ids)}


def email_worker(event):
    max_retries = 4
    for attempt in range(max_retries):
        try:
            send_email(event['studentId'], event['message'])
            return "success"
        except:
            if attempt < max_retries - 1:
                wait = 5 * (2 ** attempt)
                time.sleep(wait)
            else:
                dlq.send(event)  # Move to DLQ
                return "failed"
```

---

End of Stage 5

# Stage 6 — Priority Inbox

## Approach: Min-Heap for Top-N

**Why Min-Heap?**
- Full sort: O(m log m) where m = total notifications
- Min-heap of size N: O(m log N) → much faster when m >> N
- Only need to maintain N elements, not all m

**Algorithm:**
1. Use min-heap to keep lowest-priority item at root
2. For each new notification: O(log N) to potentially insert
3. If heap not full: add directly
4. If heap full and new item > root: replace root and heapify → O(log N)
5. At any time, heap contains exactly top N items

---

## Working Code

```javascript
const https = require('https');

const PRIORITY = { 'Placement': 3, 'Result': 2, 'Event': 1 };

class PriorityInbox {
    constructor(n = 10) {
        this.n = n;
        this.heap = [];
        this.seenIds = new Set();
    }

    compare(a, b) {
        const pA = PRIORITY[a.Type] || 0;
        const pB = PRIORITY[b.Type] || 0;
        if (pA !== pB) return pB - pA;
        return new Date(b.Timestamp) - new Date(a.Timestamp);
    }

    pushNotification(notification) {
        if (this.seenIds.has(notification.ID)) return;
        this.seenIds.add(notification.ID);

        if (this.heap.length < this.n) {
            this.heap.push(notification);
            this.bubbleUp(this.heap.length - 1);
        } else if (this.compare(notification, this.heap[0]) > 0) {
            this.heap[0] = notification;
            this.bubbleDown(0);
        }
    }

    bubbleUp(i) {
        while (i > 0) {
            const parent = Math.floor((i - 1) / 2);
            if (this.compare(this.heap[i], this.heap[parent]) <= 0) break;
            [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
            i = parent;
        }
    }

    bubbleDown(i) {
        while (true) {
            let smallest = i;
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            if (left < this.heap.length && this.compare(this.heap[left], this.heap[smallest]) < 0) smallest = left;
            if (right < this.heap.length && this.compare(this.heap[right], this.heap[smallest]) < 0) smallest = right;
            if (smallest === i) break;
            [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
            i = smallest;
        }
    }

    getTopN() {
        return this.heap.slice().sort((a, b) => this.compare(a, b));
    }
}

function fetchNotifications(authToken) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '20.207.122.201',
            path: '/evaluation-service/notifications',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        };

        const req = https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed.notifications || []);
                } catch (e) { reject(e); }
            });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

async function main() {
    const config = {
        n: 10,
        pollInterval: 5000,
        authToken: process.env.AUTH_TOKEN || 'your-token-here'
    };

    const inbox = new PriorityInbox(config.n);
    console.log(`Priority Inbox initialized with N=${config.n}`);

    async function poll() {
        try {
            const notifications = await fetchNotifications(config.authToken);
            for (const n of notifications) {
                inbox.pushNotification(n);
            }
            const top = inbox.getTopN();
            console.log('Top', top.length, 'notifications:');
            top.forEach((n, i) => console.log(`  ${i + 1}. [${n.Type}] ${n.Message}`));
        } catch (e) {
            console.error('Error:', e.message);
        }
    }

    poll();
    setInterval(poll, config.pollInterval);
}

main();
```

---

## Time Complexity

| Operation | Complexity | Explanation |
|-----------|------------|-------------|
| Push notification | O(log N) | Heap insert or replace + bubble |
| Get top N | O(N log N) | Final sort of heap |
| API fetch | O(m) | Network + parse |

**Total for m notifications:** O(m log N) — efficient when N << m

---

## Handling Continuous Updates

**Problem:** New notifications arrive continuously
**Solution:** Maintain sliding window of heap

| Scenario | Action |
|----------|--------|
| New notification arrives | pushNotification() — O(log N) |
| Duplicate notification | seenIds check — O(1) |
| Heap full, new lower priority | Ignored (not in top N) |
| Heap full, new higher priority | Replace root + bubbleDown — O(log N) |

**Continuous polling:**
- Poll every 5 seconds (configurable)
- Each poll adds new notifications to heap
- Heap automatically maintains top N by priority

**Memory:** O(N) for heap + O(m) for seenIds (deduplication)

---

End of Stage 6