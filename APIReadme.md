# API Documentation

This document describes all available API endpoints for the Probemaster2 backend.

## Base URL

All API endpoints are prefixed with `/api` unless otherwise noted. The base URL depends on your deployment.

## Authentication

Some endpoints require authentication via the `X-Access-Key` header:
```
X-Access-Key: your-access-key
```

Endpoints that require authentication are marked with 🔒.

## Endpoints

### Probe Data

#### `POST /api/probedata` or `POST /probedata`
Send probe data from a sensor device.

**Headers:**
- `Content-Type`: `text/plain`

**Request Body:**
Plain text string in format: `{probeId} {data}`

**Format:**
```
F16R co2=454,temp=25.5,hum=36.2,db=67,rssi=-57
```

Where:
- `F16R` is a 4-character probe ID (followed by space)
- Data follows in key=value format

**Probe ID Format:**
- Floor probes: `F{floor}{location}` where location is `R` (Rotunda) or `H` (Hallway)
  - Example: `F17R` = Floor 17, Rotunda
  - Example: `F16H` = Floor 16, Hallway
- Pool: `POOL` → Pool, Line
- Tea room: `TEA1` or `TEA2` → Tea_room, Location1 or Location2

**Response:**
```json
{
  "id": "1763076021254509129-56",
  "timestamp": "2025-11-13T23:20:21.254514875Z",
  "status": "received"
}
```

**Example:**
```bash
curl -X POST http://localhost:8080/api/probedata \
  -H "Content-Type: text/plain" \
  -d "F16R co2=454,temp=25.5,hum=36.2,db=67,rssi=-57"
```

**Note:** The server automatically parses the probe ID and adds it to the area store based on the probe ID pattern.

---

#### `GET /api/poll` or `POST /api/poll`
Poll for new probe messages since the last message ID.

**Query Parameters (GET):**
- `lastId` (optional): The last message ID you received

**Request Body (POST):**
```json
{
  "lastId": "1763076021254509129-56"
}
```

**Response:**
```json
{
  "messages": [
    {
      "id": "1763076021254509129-57",
      "data": "F17R co2=462,temp=21.7,hum=42.7,db=49.8,rssi=-52",
      "timestamp": "2025-11-13T23:20:22.254514875Z"
    }
  ],
  "count": 1
}
```

**Example:**
```bash
# First poll (get all messages)
curl http://localhost:8080/api/poll

# Subsequent polls (get new messages only)
curl "http://localhost:8080/api/poll?lastId=1763076021254509129-56"
```

**Example with POST:**
```bash
curl -X POST http://localhost:8080/api/poll \
  -H "Content-Type: application/json" \
  -d '{"lastId": "1763076021254509129-56"}'
```

---

#### `GET /api/clear` or `POST /api/clear`
Clear all stored probe messages from memory.

**Response:**
```json
{
  "status": "cleared"
}
```

**Example:**
```bash
curl -X POST http://localhost:8080/api/clear
```

---

### Areas

#### `GET /api/areas`
Get all areas with their locations and probe assignments.

**Response:**
```json
{
  "areas": [
    "AREA: FLOOR17 (no probes)",
    "AREA: FLOOR16 ROTUNDA F16R",
    "AREA: FLOOR16 HALLWAY F16H",
    "AREA: POOL LINE POOL"
  ]
}
```

**Format:**
- Areas with no probes: `AREA: {AREA} (no probes)`
- Areas with probes: `AREA: {AREA} {LOCATION} {PROBE_ID}`

**Example:**
```bash
curl http://localhost:8080/api/areas
```

**Note:** The server maintains predefined areas: FLOOR17, FLOOR16, FLOOR15, FLOOR12, FLOOR11, TEAROOM, POOL. Locations are automatically added as probe data is received.

---

### Statistics

#### `GET /api/stats`
Get statistics for all areas or a specific area.

**Query Parameters:**
- `area` (optional): Filter by area name (e.g., `FLOOR17`)

**Response:**
```json
{
  "stats": [
    {
      "name": "FLOOR17",
      "metrics": [
        {
          "name": "co2",
          "min": 400.0,
          "max": 600.0,
          "min_o": 350.0,
          "max_o": 650.0
        },
        {
          "name": "temp",
          "min": 20.0,
          "max": 25.0,
          "min_o": 18.0,
          "max_o": 27.0
        }
      ]
    }
  ]
}
```

**Example - Get all stats:**
```bash
curl http://localhost:8080/api/stats
```

**Example - Get stats for specific area:**
```bash
curl "http://localhost:8080/api/stats?area=FLOOR17"
```

---

#### `POST /api/stats`
Send statistics data from a device.

**Headers:**
- `Content-Type`: `text/plain`

**Request Body:**
Plain text string in format:
```
STAT: {area} {metric} min:{min} max:{max} min_o:{min_o} max_o:{max_o}
```

**Example:**
```
STAT: FLOOR17 co2 min:400.0 max:600.0 min_o:350.0 max_o:650.0
```

**Response:**
```json
{
  "status": "received"
}
```

**Example:**
```bash
curl -X POST http://localhost:8080/api/stats \
  -H "Content-Type: text/plain" \
  -d "STAT: FLOOR17 co2 min:400.0 max:600.0 min_o:350.0 max_o:650.0"
```

**Note:** Multiple stat messages can be sent separately over time. Each message updates only the specific area/metric combination.

---

### Thresholds

#### `GET /api/thresholds/{areaname}`
Get thresholds for a specific area.

**Path Parameters:**
- `areaname`: The area name (e.g., `FLOOR17`, `POOL`)

**Response:**
```json
{
  "thresholds": [
    {
      "metric": "co2",
      "values": [100.0, 200.0, 300.0, 400.0, 500.0, 600.0]
    },
    {
      "metric": "temp",
      "values": [18.0, 20.0, 22.0, 24.0, 26.0, 28.0]
    }
  ]
}
```

**Example:**
```bash
curl http://localhost:8080/api/thresholds/FLOOR17
```

---

#### `POST /api/thresholds/{areaname}`
Set thresholds for a specific area.

**Path Parameters:**
- `areaname`: The area name (e.g., `FLOOR17`, `POOL`)

**Headers:**
- `Content-Type`: `application/json`

**Request Body:**
```json
{
  "thresholds": [
    {
      "metric": "co2",
      "values": [100.0, 200.0, 300.0, 400.0, 500.0, 600.0]
    },
    {
      "metric": "temp",
      "values": [18.0, 20.0, 22.0, 24.0, 26.0, 28.0]
    }
  ]
}
```

**Response:**
```json
{
  "status": "received"
}
```

**Example:**
```bash
curl -X POST http://localhost:8080/api/thresholds/FLOOR17 \
  -H "Content-Type: application/json" \
  -d '{
    "thresholds": [
      {
        "metric": "co2",
        "values": [100.0, 200.0, 300.0, 400.0, 500.0, 600.0]
      }
    ]
  }'
```

**Note:** 
- Each threshold must have exactly 6 values
- Metric names are normalized to lowercase (co2, temp, hum, db)
- Multiple metrics can be sent in a single request

---

### Pixels

#### `GET /api/pixels`
Get pixel counts for all areas.

**Response:**
```json
{
  "pixelCount": [
    {
      "area": "FLOOR11",
      "pixels": "6*"
    },
    {
      "area": "FLOOR12",
      "pixels": "5"
    },
    {
      "area": "POOL",
      "pixels": "3"
    }
  ]
}
```

**Format:**
- `area`: Area name (normalized to uppercase)
- `pixels`: Pixel count as a string, value 0-6, optionally with `*` suffix (e.g., `"6*"`, `"5"`)

**Example:**
```bash
curl http://localhost:8080/api/pixels
```

---

#### `POST /api/pixels`
Set pixel counts for areas.

**Headers:**
- `Content-Type`: `application/json`

**Request Body:**
```json
{
  "pixelCount": [
    {
      "area": "Floor11",
      "pixels": "6*"
    },
    {
      "area": "Floor12",
      "pixels": "5"
    }
  ]
}
```

**Response:**
```json
{
  "status": "received"
}
```

**Example:**
```bash
curl -X POST http://localhost:8080/api/pixels \
  -H "Content-Type: application/json" \
  -d '{
    "pixelCount": [
      {"area": "Floor11", "pixels": "6*"},
      {"area": "Floor12", "pixels": "5"}
    ]
  }'
```

**Note:**
- Pixel values must be between 0-6
- The `*` character is preserved if included (e.g., `"6*"` vs `"6"`)
- Area names are normalized to uppercase for storage
- Multiple areas can be updated in a single request

---

### Probe Configuration

#### `GET /api/probeconfig`
Get the current probe refresh interval (how often probes should send data).

**Response:**
```json
{
  "refresh": 10
}
```

Where `refresh` is the interval in seconds (default: 10).

**Example:**
```bash
curl http://localhost:8080/api/probeconfig
```

---

#### `POST /api/probeconfig` or `PUT /api/probeconfig`
Set the probe refresh interval.

**Headers:**
- `Content-Type`: `application/json`

**Request Body:**
```json
{
  "refresh": 20
}
```

**Response:**
```json
{
  "refresh": 20,
  "status": "updated"
}
```

**Example:**
```bash
curl -X PUT http://localhost:8080/api/probeconfig \
  -H "Content-Type: application/json" \
  -d '{"refresh": 20}'
```

---

### WebSocket

#### `GET /ws`
WebSocket endpoint for real-time probe message updates.

**Upgrade:** The connection is upgraded from HTTP to WebSocket.

**Initial Message:**
On connection, the server sends all current messages as a JSON array:
```json
[
  {
    "id": "1763076021254509129-56",
    "data": "F16R co2=454,temp=25.5,hum=36.2,db=67,rssi=-57",
    "timestamp": "2025-11-13T23:20:21.254514875Z"
  }
]
```

**Subsequent Messages:**
As new probe data arrives, the server sends individual message objects:
```json
{
  "id": "1763076021254509129-57",
  "data": "F17R co2=462,temp=21.7,hum=42.7,db=49.8,rssi=-52",
  "timestamp": "2025-11-13T23:20:22.254514875Z"
}
```

**Example (JavaScript):**
```javascript
const ws = new WebSocket('ws://localhost:8080/ws');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};
```

---

## Data Storage

All probe data, areas, stats, and thresholds are stored **in memory** on the server. This means:
- Data is lost when the server restarts
- Maximum of 100 probe messages are stored (oldest are removed when limit is reached)
- Areas, stats, and thresholds persist until server restart or explicit clearing

---

## CORS

All endpoints support CORS with `Access-Control-Allow-Origin: *` for development. In production, you may want to restrict this.

---

## Error Responses

All endpoints return standard HTTP status codes:
- `200 OK`: Success
- `400 Bad Request`: Invalid request format
- `401 Unauthorized`: Missing or invalid access key
- `405 Method Not Allowed`: HTTP method not supported
- `500 Internal Server Error`: Server error

Error responses typically include a plain text error message in the response body.

---

## Example: Complete Probe Data Flow

1. **Device sends probe data:**
```bash
curl -X POST http://localhost:8080/api/probedata \
  -H "Content-Type: text/plain" \
  -d "F16R co2=454,temp=25.5,hum=36.2,db=67,rssi=-57"
```

2. **Frontend polls for new messages:**
```bash
curl "http://localhost:8080/api/poll?lastId=previous-id"
```

3. **Check areas (probe automatically added):**
```bash
curl http://localhost:8080/api/areas
# Returns: AREA: FLOOR16 ROTUNDA F16R
```

4. **Send statistics:**
```bash
curl -X POST http://localhost:8080/api/stats \
  -H "Content-Type: text/plain" \
  -d "STAT: FLOOR16 co2 min:400.0 max:600.0 min_o:350.0 max_o:650.0"
```

5. **Get statistics:**
```bash
curl "http://localhost:8080/api/stats?area=FLOOR16"
```

6. **Set thresholds:**
```bash
curl -X POST http://localhost:8080/api/thresholds/FLOOR16 \
  -H "Content-Type: application/json" \
  -d '{
    "thresholds": [
      {
        "metric": "co2",
        "values": [100.0, 200.0, 300.0, 400.0, 500.0, 600.0]
      }
    ]
  }'
```

7. **Get thresholds:**
```bash
curl http://localhost:8080/api/thresholds/FLOOR16
```

8. **Get pixel counts:**
```bash
curl http://localhost:8080/api/pixels
```

9. **Set pixel counts:**
```bash
curl -X POST http://localhost:8080/api/pixels \
  -H "Content-Type: application/json" \
  -d '{
    "pixelCount": [
      {"area": "FLOOR16", "pixels": "5"}
    ]
  }'
```

