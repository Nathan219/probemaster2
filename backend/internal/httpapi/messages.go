package httpapi

import (
	"fmt"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// AreaLocation represents a location within an area with its probe ID
type AreaLocation struct {
	Location string `json:"location"`
	ProbeID  string `json:"probeId"`
}

// AreaStore stores areas and their locations
type AreaStore struct {
	areas map[string][]AreaLocation // area -> locations
}

type ProbeMessage struct {
	ID        string    `json:"id"`
	Data      string    `json:"data"`
	Timestamp time.Time `json:"timestamp"`
}

type MessageStore struct {
	messages  []ProbeMessage
	maxSize   int
	clients   map[*websocket.Conn]bool
	broadcast chan ProbeMessage
	counter   int64 // Counter for unique ID generation
}

func NewMessageStore(maxSize int) *MessageStore {
	return &MessageStore{
		messages:  make([]ProbeMessage, 0, maxSize),
		maxSize:   maxSize,
		clients:   make(map[*websocket.Conn]bool),
		broadcast: make(chan ProbeMessage, 256),
		counter:   0,
	}
}

func (ms *MessageStore) AddMessage(data string) ProbeMessage {
	msg := ProbeMessage{
		ID:        ms.generateID(),
		Data:      data,
		Timestamp: time.Now(),
	}

	ms.messages = append(ms.messages, msg)
	if len(ms.messages) > ms.maxSize {
		ms.messages = ms.messages[1:]
	}

	// Broadcast to WebSocket clients
	select {
	case ms.broadcast <- msg:
	default:
		// Channel full, skip broadcast
	}

	return msg
}

func (ms *MessageStore) GetMessages() []ProbeMessage {
	// Return a copy
	result := make([]ProbeMessage, len(ms.messages))
	copy(result, ms.messages)
	return result
}

// GetMessagesAfter returns messages with IDs greater than the given lastID
// If maxLength is > 0, limits results to that many messages (defaults to 10 if 0)
func (ms *MessageStore) GetMessagesAfter(lastID string, maxLength int) []ProbeMessage {
	if maxLength <= 0 {
		maxLength = 10 // Default to 10 if not specified
	}

	if lastID == "" {
		// Return last maxLength messages if no lastID provided
		startIdx := len(ms.messages) - maxLength
		if startIdx < 0 {
			startIdx = 0
		}
		result := make([]ProbeMessage, len(ms.messages)-startIdx)
		copy(result, ms.messages[startIdx:])
		return result
	}

	// Find the index of the lastID, or start from the beginning if not found
	startIdx := 0
	for i, msg := range ms.messages {
		if msg.ID == lastID {
			startIdx = i + 1
			break
		}
		// If we've passed where it should be (messages are in order), break
		if msg.ID > lastID {
			break
		}
	}

	// Return messages after the lastID
	if startIdx >= len(ms.messages) {
		return []ProbeMessage{}
	}

	// Limit to maxLength messages
	availableCount := len(ms.messages) - startIdx
	if availableCount > maxLength {
		availableCount = maxLength
	}

	result := make([]ProbeMessage, availableCount)
	copy(result, ms.messages[startIdx:startIdx+availableCount])
	return result
}

// GetMessagesBefore returns messages with IDs less than the given beforeID
// Returns up to maxLength messages (defaults to 100 if 0)
// Messages are returned in reverse chronological order (newest first)
func (ms *MessageStore) GetMessagesBefore(beforeID string, maxLength int) []ProbeMessage {
	if maxLength <= 0 {
		maxLength = 100 // Default to 100 if not specified
	}

	if beforeID == "" {
		// Return last maxLength messages if no beforeID provided
		startIdx := len(ms.messages) - maxLength
		if startIdx < 0 {
			startIdx = 0
		}
		result := make([]ProbeMessage, len(ms.messages)-startIdx)
		copy(result, ms.messages[startIdx:])
		return result
	}

	// Find the index of the beforeID
	endIdx := len(ms.messages)
	for i, msg := range ms.messages {
		if msg.ID == beforeID {
			endIdx = i
			break
		}
		// If we've passed where it should be (messages are in order), break
		if msg.ID > beforeID {
			endIdx = i
			break
		}
	}

	// Return messages before the beforeID
	if endIdx <= 0 {
		return []ProbeMessage{}
	}

	// Limit to maxLength messages, taking from the end (newest first)
	startIdx := endIdx - maxLength
	if startIdx < 0 {
		startIdx = 0
	}

	result := make([]ProbeMessage, endIdx-startIdx)
	copy(result, ms.messages[startIdx:endIdx])
	return result
}

func (ms *MessageStore) Clear() {
	ms.messages = make([]ProbeMessage, 0, ms.maxSize)
}

func (ms *MessageStore) generateID() string {
	ms.counter++
	// Use timestamp + counter for unique ID
	return fmt.Sprintf("%d-%d", time.Now().UnixNano(), ms.counter)
}

// NewAreaStore creates a new area store with predefined areas
func NewAreaStore() *AreaStore {
	as := &AreaStore{
		areas: make(map[string][]AreaLocation),
	}
	// Initialize with predefined areas (empty locations initially)
	predefinedAreas := []string{"FLOOR17", "FLOOR16", "FLOOR15", "FLOOR12", "FLOOR11", "TEAROOM", "POOL"}
	for _, area := range predefinedAreas {
		as.areas[area] = []AreaLocation{}
	}
	return as
}

// AddLocation adds or updates a location for an area
func (as *AreaStore) AddLocation(area, location, probeID string) {
	// Normalize area name to uppercase
	areaUpper := ""
	if len(area) > 0 {
		// Handle Floor17 -> FLOOR17, Tea_room -> TEAROOM, pool -> POOL
		if len(area) > 5 && (area[:5] == "Floor" || area[:5] == "floor") {
			areaUpper = "FLOOR" + area[5:]
		} else if area == "Tea_room" || area == "tea_room" || area == "TEAROOM" {
			areaUpper = "TEAROOM"
		} else if area == "pool" || area == "Pool" || area == "POOL" {
			areaUpper = "POOL"
		} else {
			// Already uppercase or other format
			areaUpper = area
		}
	}

	// Normalize location name
	locationUpper := ""
	if location == "Rotunda" || location == "rotunda" || location == "ROTUNDA" {
		locationUpper = "ROTUNDA"
	} else if location == "Hallway" || location == "hallway" || location == "HALLWAY" {
		locationUpper = "HALLWAY"
	} else if location == "Line" || location == "line" || location == "LINE" {
		locationUpper = "LINE"
	} else if location == "Location1" || location == "location1" || location == "LOCATION1" {
		locationUpper = "LOCATION1"
	} else if location == "Location2" || location == "location2" || location == "LOCATION2" {
		locationUpper = "LOCATION2"
	} else {
		locationUpper = location
	}

	if areaUpper == "" || locationUpper == "" {
		return // Invalid area or location
	}

	// Check if location already exists for this area
	locations := as.areas[areaUpper]
	for i, loc := range locations {
		if loc.Location == locationUpper {
			// Update existing location with new probe ID
			locations[i].ProbeID = probeID
			as.areas[areaUpper] = locations
			return
		}
	}

	// Add new location
	as.areas[areaUpper] = append(locations, AreaLocation{
		Location: locationUpper,
		ProbeID:  probeID,
	})
}

// RemoveProbe removes a probe assignment from whichever area/location currently holds it
func (as *AreaStore) RemoveProbe(probeID string) {
	if probeID == "" {
		return
	}

	trimmedID := strings.TrimSpace(probeID)
	for area, locations := range as.areas {
		for i, loc := range locations {
			if loc.ProbeID == trimmedID {
				// Remove this location entry
				as.areas[area] = append(locations[:i], locations[i+1:]...)
				break
			}
		}
	}
}

// ProbeAssigned checks if a probe ID is already assigned to any area/location
func (as *AreaStore) ProbeAssigned(probeID string) bool {
	if probeID == "" {
		return false
	}
	trimmedID := strings.TrimSpace(probeID)
	for _, locations := range as.areas {
		for _, loc := range locations {
			if strings.EqualFold(loc.ProbeID, trimmedID) {
				return true
			}
		}
	}
	return false
}

// GetAreas returns all areas with their locations
func (as *AreaStore) GetAreas() map[string][]AreaLocation {
	// Return a copy
	result := make(map[string][]AreaLocation)
	for area, locations := range as.areas {
		locationsCopy := make([]AreaLocation, len(locations))
		copy(locationsCopy, locations)
		result[area] = locationsCopy
	}
	return result
}

// MetricStat represents statistics for a single metric
type MetricStat struct {
	Name string  `json:"name"`
	Min  float64 `json:"min"`
	Max  float64 `json:"max"`
	MinO float64 `json:"min_o"`
	MaxO float64 `json:"max_o"`
}

// AreaStat represents statistics for an area with all its metrics
type AreaStat struct {
	Name    string       `json:"name"`
	Metrics []MetricStat `json:"metrics"`
}

// StatsStore stores statistics for areas
type StatsStore struct {
	stats map[string]map[string]MetricStat // area -> metric -> stat
}

// NewStatsStore creates a new stats store
func NewStatsStore() *StatsStore {
	return &StatsStore{
		stats: make(map[string]map[string]MetricStat),
	}
}

// UpdateStat updates or creates a stat for an area and metric
func (ss *StatsStore) UpdateStat(area, metric string, min, max, minO, maxO float64) {
	// Normalize area name to uppercase
	areaUpper := strings.ToUpper(strings.TrimSpace(area))
	// Normalize metric name to lowercase
	metricLower := strings.ToLower(strings.TrimSpace(metric))

	if areaUpper == "" || metricLower == "" {
		return
	}

	// Get or create area map
	if ss.stats[areaUpper] == nil {
		ss.stats[areaUpper] = make(map[string]MetricStat)
	}

	// Update the metric stat
	ss.stats[areaUpper][metricLower] = MetricStat{
		Name: metricLower,
		Min:  min,
		Max:  max,
		MinO: minO,
		MaxO: maxO,
	}
}

// GetStats returns all stats, optionally filtered by area
func (ss *StatsStore) GetStats(areaFilter string) []AreaStat {
	var result []AreaStat

	// Normalize filter if provided
	areaFilterUpper := ""
	if areaFilter != "" {
		areaFilterUpper = strings.ToUpper(strings.TrimSpace(areaFilter))
	}

	// Iterate through all areas
	for area, metrics := range ss.stats {
		// Skip if filter doesn't match
		if areaFilterUpper != "" && area != areaFilterUpper {
			continue
		}

		// Convert metrics map to slice
		metricsSlice := make([]MetricStat, 0, len(metrics))
		for _, stat := range metrics {
			metricsSlice = append(metricsSlice, stat)
		}

		result = append(result, AreaStat{
			Name:    area,
			Metrics: metricsSlice,
		})
	}

	return result
}

// MetricThreshold represents threshold values for a single metric
type MetricThreshold struct {
	Metric string    `json:"metric"`
	Values []float64 `json:"values"`
}

// ThresholdStore stores thresholds for areas
type ThresholdStore struct {
	thresholds map[string]map[string][]float64 // area -> metric -> values
}

// NewThresholdStore creates a new threshold store
func NewThresholdStore() *ThresholdStore {
	return &ThresholdStore{
		thresholds: make(map[string]map[string][]float64),
	}
}

// UpdateThresholds updates thresholds for an area
func (ts *ThresholdStore) UpdateThresholds(area string, thresholds []MetricThreshold) {
	// Normalize area name to uppercase
	areaUpper := strings.ToUpper(strings.TrimSpace(area))

	if areaUpper == "" {
		return
	}

	// Get or create area map
	if ts.thresholds[areaUpper] == nil {
		ts.thresholds[areaUpper] = make(map[string][]float64)
	}

	// Update each metric's thresholds
	for _, threshold := range thresholds {
		metricLower := strings.ToLower(strings.TrimSpace(threshold.Metric))
		if metricLower != "" {
			// Ensure we have exactly 6 values
			values := make([]float64, 6)
			copy(values, threshold.Values)
			// Pad with 0 if needed
			for i := len(threshold.Values); i < 6; i++ {
				values[i] = 0
			}
			// Trim to 6 if more
			if len(values) > 6 {
				values = values[:6]
			}
			ts.thresholds[areaUpper][metricLower] = values
		}
	}
}

// GetThresholds returns thresholds for an area
func (ts *ThresholdStore) GetThresholds(area string) []MetricThreshold {
	// Normalize area name to uppercase
	areaUpper := strings.ToUpper(strings.TrimSpace(area))

	if areaUpper == "" {
		return []MetricThreshold{}
	}

	metrics, exists := ts.thresholds[areaUpper]
	if !exists {
		return []MetricThreshold{}
	}

	var result []MetricThreshold
	for metric, values := range metrics {
		// Make a copy of values
		valuesCopy := make([]float64, len(values))
		copy(valuesCopy, values)
		result = append(result, MetricThreshold{
			Metric: metric,
			Values: valuesCopy,
		})
	}

	return result
}

// PixelCount represents pixel count for an area
type PixelCount struct {
	Area   string `json:"area"`
	Pixels string `json:"pixels"` // String format: "0" to "6" or "0*" to "6*"
}

// PixelStore stores pixel counts for areas
type PixelStore struct {
	pixels map[string]string // area -> pixels (as string to preserve *)
}

// NewPixelStore creates a new pixel store
func NewPixelStore() *PixelStore {
	return &PixelStore{
		pixels: make(map[string]string),
	}
}

// UpdatePixels updates pixel counts for areas
func (ps *PixelStore) UpdatePixels(pixelCounts []PixelCount) {
	for _, pc := range pixelCounts {
		// Normalize area name to uppercase
		areaUpper := strings.ToUpper(strings.TrimSpace(pc.Area))
		if areaUpper != "" {
			// Validate pixels format: should be "0" to "6" or "0*" to "6*"
			pixelsStr := strings.TrimSpace(pc.Pixels)
			if pixelsStr != "" {
				// Remove * for validation, check if it's 0-6
				pixelsClean := strings.TrimSuffix(pixelsStr, "*")
				if len(pixelsClean) == 1 && pixelsClean[0] >= '0' && pixelsClean[0] <= '6' {
					ps.pixels[areaUpper] = pixelsStr
				}
			}
		}
	}
}

// GetPixels returns all pixel counts
func (ps *PixelStore) GetPixels() []PixelCount {
	var result []PixelCount
	for area, pixels := range ps.pixels {
		result = append(result, PixelCount{
			Area:   area,
			Pixels: pixels,
		})
	}
	return result
}
