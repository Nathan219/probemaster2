package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/probemaster2/internal/config"
)

type probeAssignment struct {
	Area     string
	Location string
}

var fixedProbeAssignments = map[string]probeAssignment{
	"F17R": {Area: "FLOOR17", Location: "ROTUNDA"},
	"F17H": {Area: "FLOOR17", Location: "HALLWAY"},
	"F16R": {Area: "FLOOR16", Location: "ROTUNDA"},
	"F16H": {Area: "FLOOR16", Location: "HALLWAY"},
	"F15R": {Area: "FLOOR15", Location: "ROTUNDA"},
	"F15H": {Area: "FLOOR15", Location: "HALLWAY"},
	"F12R": {Area: "FLOOR12", Location: "ROTUNDA"},
	"F12H": {Area: "FLOOR12", Location: "HALLWAY"},
	"F11R": {Area: "FLOOR11", Location: "ROTUNDA"},
	"F11H": {Area: "FLOOR11", Location: "HALLWAY"},
	"TEA1": {Area: "TEAROOM", Location: "LOCATION1"},
	"TEA2": {Area: "TEAROOM", Location: "LOCATION2"},
	"POOL": {Area: "POOL", Location: "LINE"},
}

type router struct {
	cfg                  config.Config
	mux                  *http.ServeMux
	messageStore         *MessageStore
	areaStore            *AreaStore
	statsStore           *StatsStore
	thresholdStore       *ThresholdStore
	pixelStore           *PixelStore
	upgrader             websocket.Upgrader
	probeRefreshInterval int // Probe refresh interval in seconds
	pixelLastUpdated     time.Time
	sendCommandValue     string
	sendCommandReceived  bool
}

func NewRouter(cfg config.Config) *http.ServeMux {
	msgStore := NewMessageStore(5000)
	areaStore := NewAreaStore()
	statsStore := NewStatsStore()
	thresholdStore := NewThresholdStore()
	pixelStore := NewPixelStore()
	r := &router{
		cfg:            cfg,
		mux:            http.NewServeMux(),
		messageStore:   msgStore,
		areaStore:      areaStore,
		statsStore:     statsStore,
		thresholdStore: thresholdStore,
		pixelStore:     pixelStore,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for now
			},
		},
		probeRefreshInterval: 60, // Default 10 seconds
		pixelLastUpdated:     time.Time{},
		sendCommandValue:     "",
		sendCommandReceived:  true,
	}
	r.routes()
	go r.handleBroadcast()
	return r.mux
}

func (r *router) routes() {
	r.mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte("ok"))
	})
	r.mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte("ok"))
	})

	// NEW endpoint for version info
	r.mux.HandleFunc("/api/version", func(w http.ResponseWriter, _ *http.Request) {
		resp := map[string]string{
			"backend_version": r.cfg.Version,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	// Probe data endpoints - support both /probedata and /api/probedata for compatibility
	r.mux.HandleFunc("/probedata", r.handleProbeData)
	r.mux.HandleFunc("/api/probedata", r.handleProbeData)
	r.mux.HandleFunc("/api/poll", r.handlePoll)
	r.mux.HandleFunc("/api/clear", r.handleClear)
	r.mux.HandleFunc("/api/probeconfig", r.handleProbeConfig)
	r.mux.HandleFunc("/api/areas", r.handleGetAreas)
	r.mux.HandleFunc("/api/stats", r.handleStats)
	r.mux.HandleFunc("/api/thresholds/", r.handleThresholds)
	r.mux.HandleFunc("/api/pixels", r.handlePixels)
	r.mux.HandleFunc("/api/probes/", r.handleProbes)
	r.mux.HandleFunc("/api/sendcommand", r.handleSendCommand)
	r.mux.HandleFunc("/api/sendcommandreceived", r.handleSendCommandReceived)
	r.mux.HandleFunc("/api/pixeltimestamp", r.handlePixelTimestamp)
	r.mux.HandleFunc("/ws", r.handleWebSocket)
}

func (r *router) requireKey(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		key := req.Header.Get("X-Access-Key")
		if key == "" || key != r.cfg.AccessKey {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, req)
	}
}

func (r *router) handleProbeData(w http.ResponseWriter, req *http.Request) {
	// Handle CORS preflight
	if req.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusOK)
		return
	}

	if req.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Set CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")

	body, err := io.ReadAll(req.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	data := string(body)
	msg := r.messageStore.AddMessage(data)

	// Parse probe ID from data and add to area store
	// Format: "F16R co2=454,temp=25.5,hum=36.2,db=67,rssi=-57"
	// 4 character probe ID, followed by space, then data
	var probeID string
	if len(data) >= 5 {
		// Check if first 4 chars are followed by a space
		if data[4] == ' ' {
			probeID = data[:4]
		}
	}

	// If we have a probe ID, try to parse it and add to area store
	// Preserve original case of probe ID
	if probeID != "" {
		probeIDTrimmed := strings.TrimSpace(probeID)
		area, location := r.parseProbeID(probeIDTrimmed)
		if area != "" && location != "" && !r.areaStore.ProbeAssigned(probeIDTrimmed) {
			r.areaStore.AddLocation(area, location, probeIDTrimmed)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"id":        msg.ID,
		"timestamp": msg.Timestamp,
		"status":    "received",
	})
}

// parseProbeID parses a probe ID and returns area and location
// Format: "F16R" -> FLOOR16, ROTUNDA
//
//	"F17H" -> FLOOR17, HALLWAY
//	"POOL" -> POOL, LINE
//	"TEA1" -> TEAROOM, LOCATION1
//	"TEA2" -> TEAROOM, LOCATION2
//
// Note: This function uses uppercase for pattern matching but does not modify the original probe ID
func (r *router) parseProbeID(probeID string) (area, location string) {
	if fixedArea, fixedLocation := r.lookupFixedProbeAssignment(probeID); fixedArea != "" {
		return fixedArea, fixedLocation
	}
	// Use uppercase only for pattern matching, but preserve original case
	upperID := strings.ToUpper(probeID)
	if len(upperID) < 2 {
		return "", ""
	}

	// Floor probes: F17R, F17H, F16R, F11R, F11H, etc.
	// Pattern: F followed by digits, then R or H
	if len(upperID) >= 4 && upperID[0] == 'F' {
		// Extract floor number (digits after F)
		floorNum := ""
		i := 1
		for i < len(upperID) && upperID[i] >= '0' && upperID[i] <= '9' {
			floorNum += string(upperID[i])
			i++
		}
		// Check if we have a location code after the floor number
		// For F11R/F11H: F(0), 1(1), 1(2), R(3) - i should be 3, len is 4, so i < len is true
		if i < len(upperID) && floorNum != "" {
			locCode := upperID[i]
			if locCode == 'R' {
				return "FLOOR" + floorNum, "ROTUNDA"
			} else if locCode == 'H' {
				return "FLOOR" + floorNum, "HALLWAY"
			}
		}
	}

	// Pool: POOL
	if upperID == "POOL" {
		return "POOL", "LINE"
	}

	// Tea room: TEA1, TEA2
	if len(upperID) == 4 && upperID[:3] == "TEA" {
		if upperID[3] == '1' {
			return "TEAROOM", "LOCATION1"
		} else if upperID[3] == '2' {
			return "TEAROOM", "LOCATION2"
		}
	}

	return "", ""
}

func (r *router) lookupFixedProbeAssignment(probeID string) (string, string) {
	id := strings.ToUpper(strings.TrimSpace(probeID))
	if assignment, ok := fixedProbeAssignments[id]; ok {
		return assignment.Area, assignment.Location
	}
	return "", ""
}

func (r *router) handlePoll(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" && req.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Set CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Handle CORS preflight
	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Get parameters from query or body
	var lastID string
	var beforeID string
	var maxLength int
	if req.Method == "GET" {
		lastID = req.URL.Query().Get("lastId")
		beforeID = req.URL.Query().Get("beforeId")
		lengthStr := req.URL.Query().Get("length")
		if lengthStr != "" {
			if parsed, err := strconv.Atoi(lengthStr); err == nil {
				maxLength = parsed
			}
		}
	} else {
		var body struct {
			LastID   string `json:"lastId"`
			BeforeID string `json:"beforeId"`
			Length   int    `json:"length"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err == nil {
			lastID = body.LastID
			beforeID = body.BeforeID
			maxLength = body.Length
		}
	}

	// Get messages based on pagination direction
	var messages []ProbeMessage
	if beforeID != "" {
		// Pagination: get messages before this ID (for fetching older messages)
		if maxLength <= 0 {
			maxLength = 100 // Default to 100 for pagination
		}
		messages = r.messageStore.GetMessagesBefore(beforeID, maxLength)
	} else {
		// Normal polling: get messages after lastID (defaults to max 10 if length not specified)
		messages = r.messageStore.GetMessagesAfter(lastID, maxLength)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"messages": messages,
		"count":    len(messages),
	})
}

func (r *router) handleClear(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" && req.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.messageStore.Clear()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "cleared"})
}

func (r *router) handleGetAreas(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Set CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	// Get all areas
	areas := r.areaStore.GetAreas()

	// Convert to JSON array format: [{area, location, probeID}, ...]
	var response []map[string]string
	for area, locations := range areas {
		if len(locations) == 0 {
			// Area with no probes - still include it but with empty location and probeID
			response = append(response, map[string]string{
				"area":     area,
				"location": "",
				"probeID":  "",
			})
		} else {
			// Area with locations/probes
			for _, loc := range locations {
				response = append(response, map[string]string{
					"area":     area,
					"location": loc.Location,
					"probeID":  loc.ProbeID,
				})
			}
		}
	}

	json.NewEncoder(w).Encode(response)
}

func (r *router) handleStats(w http.ResponseWriter, req *http.Request) {
	// Set CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Handle CORS preflight
	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if req.Method == "GET" {
		// Get area filter from query parameter
		areaFilter := req.URL.Query().Get("area")

		// Get stats (filtered by area if provided)
		stats := r.statsStore.GetStats(areaFilter)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"stats": stats,
		})
		return
	}

	if req.Method == "POST" {
		// Read the stat message string
		body, err := io.ReadAll(req.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		statMsg := string(body)

		// Parse the stat message
		// Format: "STAT: {area} {metric} min:{min} max:{max} min_o:{min_o} max_o:{max_o}"
		// Example: "STAT: FLOOR17 co2 min:400.0 max:600.0 min_o:350.0 max_o:650.0"
		err = r.parseAndUpdateStat(statMsg)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status": "received",
		})
		return
	}

	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

// parseAndUpdateStat parses a STAT message and updates the stats store
// Format: "STAT: {area} {metric} min:{min} max:{max} min_o:{min_o} max_o:{max_o}"
func (r *router) parseAndUpdateStat(statMsg string) error {
	// Find STAT: in the message
	statIdx := strings.Index(statMsg, "STAT:")
	if statIdx == -1 {
		return fmt.Errorf("STAT: not found in message")
	}

	// Extract the part after STAT:
	cleaned := strings.TrimSpace(statMsg[statIdx+5:])

	// Parse: {area} {metric} min:{min} max:{max} min_o:{min_o} max_o:{max_o}
	// Use regex to extract all parts
	// Pattern: (\S+)\s+(\S+)\s+min:([-\d.]+)\s+max:([-\d.]+)\s+min_o:([-\d.]+)\s+max_o:([-\d.]+)
	parts := strings.Fields(cleaned)
	if len(parts) < 6 {
		return fmt.Errorf("invalid stat message format")
	}

	area := parts[0]
	metric := parts[1]

	// Parse min
	var min float64
	if strings.HasPrefix(parts[2], "min:") {
		_, err := fmt.Sscanf(parts[2], "min:%f", &min)
		if err != nil {
			return fmt.Errorf("failed to parse min: %v", err)
		}
	} else {
		return fmt.Errorf("expected min: in position 2")
	}

	// Parse max
	var max float64
	if strings.HasPrefix(parts[3], "max:") {
		_, err := fmt.Sscanf(parts[3], "max:%f", &max)
		if err != nil {
			return fmt.Errorf("failed to parse max: %v", err)
		}
	} else {
		return fmt.Errorf("expected max: in position 3")
	}

	// Parse min_o
	var minO float64
	if strings.HasPrefix(parts[4], "min_o:") {
		_, err := fmt.Sscanf(parts[4], "min_o:%f", &minO)
		if err != nil {
			return fmt.Errorf("failed to parse min_o: %v", err)
		}
	} else {
		return fmt.Errorf("expected min_o: in position 4")
	}

	// Parse max_o
	var maxO float64
	if strings.HasPrefix(parts[5], "max_o:") {
		_, err := fmt.Sscanf(parts[5], "max_o:%f", &maxO)
		if err != nil {
			return fmt.Errorf("failed to parse max_o: %v", err)
		}
	} else {
		return fmt.Errorf("expected max_o: in position 5")
	}

	// Update the stats store
	r.statsStore.UpdateStat(area, metric, min, max, minO, maxO)

	return nil
}

func (r *router) handleThresholds(w http.ResponseWriter, req *http.Request) {
	// Set CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Handle CORS preflight
	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Extract area name from URL path: /api/thresholds/{areaname}
	path := req.URL.Path
	prefix := "/api/thresholds/"
	if !strings.HasPrefix(path, prefix) {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	areaName := strings.TrimPrefix(path, prefix)
	if areaName == "" {
		http.Error(w, "area name required", http.StatusBadRequest)
		return
	}

	if req.Method == "GET" {
		// Get thresholds for the area
		thresholds := r.thresholdStore.GetThresholds(areaName)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"thresholds": thresholds,
		})
		return
	}

	if req.Method == "POST" {
		// Read the JSON body
		var body struct {
			Thresholds []MetricThreshold `json:"thresholds"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Update thresholds for the area
		r.thresholdStore.UpdateThresholds(areaName, body.Thresholds)

		// Get the updated thresholds to return
		updatedThresholds := r.thresholdStore.GetThresholds(areaName)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status":     "received",
			"thresholds": updatedThresholds,
		})
		return
	}

	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func (r *router) handleProbes(w http.ResponseWriter, req *http.Request) {
	// Set CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Handle CORS preflight
	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Extract probe ID from URL path: /api/probes/{probeId}
	path := req.URL.Path
	prefix := "/api/probes/"
	if !strings.HasPrefix(path, prefix) {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	probeID := strings.TrimPrefix(path, prefix)
	if probeID == "" {
		http.Error(w, "probe ID required", http.StatusBadRequest)
		return
	}

	if req.Method == "POST" {
		// Assign probe to area and location
		var body struct {
			Area     string `json:"area"`
			Location string `json:"location"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if body.Area == "" || body.Location == "" {
			http.Error(w, "area and location required", http.StatusBadRequest)
			return
		}

		// Normalize area name (similar to AddLocation)
		areaUpper := ""
		if len(body.Area) > 0 {
			if len(body.Area) > 5 && (body.Area[:5] == "Floor" || body.Area[:5] == "floor") {
				areaUpper = "FLOOR" + body.Area[5:]
			} else if body.Area == "Tea_room" || body.Area == "tea_room" || body.Area == "TEAROOM" {
				areaUpper = "TEAROOM"
			} else if body.Area == "pool" || body.Area == "Pool" || body.Area == "POOL" {
				areaUpper = "POOL"
			} else {
				areaUpper = strings.ToUpper(strings.TrimSpace(body.Area))
			}
		}

		// Normalize location name
		locationUpper := ""
		if body.Location == "Rotunda" || body.Location == "rotunda" || body.Location == "ROTUNDA" {
			locationUpper = "ROTUNDA"
		} else if body.Location == "Hallway" || body.Location == "hallway" || body.Location == "HALLWAY" {
			locationUpper = "HALLWAY"
		} else if body.Location == "Line" || body.Location == "line" || body.Location == "LINE" {
			locationUpper = "LINE"
		} else if body.Location == "Location1" || body.Location == "location1" || body.Location == "LOCATION1" {
			locationUpper = "LOCATION1"
		} else if body.Location == "Location2" || body.Location == "location2" || body.Location == "LOCATION2" {
			locationUpper = "LOCATION2"
		} else {
			locationUpper = strings.ToUpper(strings.TrimSpace(body.Location))
		}

		if areaUpper == "" || locationUpper == "" {
			http.Error(w, "invalid area or location", http.StatusBadRequest)
			return
		}

		// Add probe to area store
		r.areaStore.AddLocation(areaUpper, locationUpper, probeID)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status":   "assigned",
			"probeID":  probeID,
			"area":     areaUpper,
			"location": locationUpper,
		})
		return
	}

	if req.Method == "DELETE" {
		// Remove probe assignment from area store
		r.areaStore.RemoveProbe(probeID)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status":  "removed",
			"probeID": probeID,
		})
		return
	}

	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func (r *router) handleSendCommand(w http.ResponseWriter, req *http.Request) {
	// Set CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Handle CORS preflight
	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if req.Method == "POST" {
		var body struct {
			Command string `json:"command"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		cmd := strings.TrimSpace(body.Command)
		if cmd == "" {
			http.Error(w, "command required", http.StatusBadRequest)
			return
		}

		r.sendCommandValue = cmd
		r.sendCommandReceived = false

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status":  "queued",
			"command": cmd,
		})
		return
	}

	if req.Method == "GET" {
		command := r.sendCommandValue
		available := command != ""

		if available {
			// Mark as received and clear the command
			r.sendCommandValue = ""
			r.sendCommandReceived = true
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"command":   command,
			"available": available,
		})
		return
	}

	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func (r *router) handleSendCommandReceived(w http.ResponseWriter, req *http.Request) {
	// Set CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Handle CORS preflight
	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if req.Method == "GET" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"received": r.sendCommandReceived,
		})
		return
	}

	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func (r *router) handlePixels(w http.ResponseWriter, req *http.Request) {
	// Set CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Handle CORS preflight
	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if req.Method == "GET" {
		// Get all pixel counts
		pixelCounts := r.pixelStore.GetPixels()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"pixelCount": pixelCounts,
		})
		return
	}

	if req.Method == "POST" {
		// Read the JSON body - support both array format and object format
		bodyBytes, err := io.ReadAll(req.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Define a flexible struct that can handle pixels as number or string
		type FlexiblePixelCount struct {
			Area   string      `json:"area"`
			Pixels interface{} `json:"pixels"` // Can be number or string
		}

		var pixelCounts []PixelCount
		var flexibleCounts []FlexiblePixelCount

		// Try to decode as array first
		if err := json.Unmarshal(bodyBytes, &flexibleCounts); err != nil {
			// If array decode fails, try object format
			var body struct {
				PixelCount []FlexiblePixelCount `json:"pixelCount"`
			}
			if err := json.Unmarshal(bodyBytes, &body); err != nil {
				http.Error(w, fmt.Sprintf("invalid JSON format: %v", err), http.StatusBadRequest)
				return
			}
			flexibleCounts = body.PixelCount
		}

		// Convert flexible format to PixelCount (convert pixels to string)
		for _, fp := range flexibleCounts {
			var pixelsStr string
			switch v := fp.Pixels.(type) {
			case string:
				pixelsStr = v
			case float64:
				// Convert number to string
				pixelsStr = fmt.Sprintf("%.0f", v)
			case int:
				pixelsStr = fmt.Sprintf("%d", v)
			default:
				// Try to convert to string
				pixelsStr = fmt.Sprintf("%v", v)
			}
			pixelCounts = append(pixelCounts, PixelCount{
				Area:   fp.Area,
				Pixels: pixelsStr,
			})
		}

		// Update pixel counts
		r.pixelStore.UpdatePixels(pixelCounts)
		r.pixelLastUpdated = time.Now()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status": "received",
		})
		return
	}

	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func (r *router) handlePixelTimestamp(w http.ResponseWriter, req *http.Request) {
	// Set CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Handle CORS preflight
	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if req.Method == "GET" {
		var iso string
		if !r.pixelLastUpdated.IsZero() {
			iso = r.pixelLastUpdated.UTC().Format(time.RFC3339)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"lastUpdated": iso,
		})
		return
	}

	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func (r *router) handleProbeConfig(w http.ResponseWriter, req *http.Request) {
	// Set CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Handle CORS preflight
	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if req.Method == "GET" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"refresh": r.probeRefreshInterval,
		})
		return
	}

	if req.Method == "POST" || req.Method == "PUT" {
		var body struct {
			Refresh int `json:"refresh"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if body.Refresh < 1 {
			http.Error(w, "refresh must be at least 1 second", http.StatusBadRequest)
			return
		}
		r.probeRefreshInterval = body.Refresh
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"refresh": r.probeRefreshInterval,
			"status":  "updated",
		})
		return
	}

	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func (r *router) handleWebSocket(w http.ResponseWriter, req *http.Request) {
	conn, err := r.upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Printf("websocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	r.messageStore.clients[conn] = true

	// Send initial messages
	messages := r.messageStore.GetMessages()
	if err := conn.WriteJSON(messages); err != nil {
		log.Printf("websocket write error: %v", err)
		delete(r.messageStore.clients, conn)
		return
	}

	// Keep connection alive and handle incoming messages
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			log.Printf("websocket read error: %v", err)
			break
		}
	}

	delete(r.messageStore.clients, conn)
}

func (r *router) handleBroadcast() {
	for msg := range r.messageStore.broadcast {
		clients := make([]*websocket.Conn, 0, len(r.messageStore.clients))
		for conn := range r.messageStore.clients {
			clients = append(clients, conn)
		}

		for _, conn := range clients {
			if err := conn.WriteJSON(msg); err != nil {
				log.Printf("websocket broadcast error: %v", err)
				delete(r.messageStore.clients, conn)
				conn.Close()
			}
		}
	}
}
