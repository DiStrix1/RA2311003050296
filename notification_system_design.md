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
```