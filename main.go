package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// Configuration
type Config struct {
	JWTSecret    string `json:"jwt_secret"`
	ServerPort   string `json:"server_port"`
	StaticFolder string `json:"static_folder"`
}

// Screening represents a movie screening
type Screening struct {
	ID         string    `json:"id"`
	Title      string    `json:"title"`
	MagnetLink string    `json:"magnet_link"`
	StartTime  time.Time `json:"start_time"`
	EndTime    time.Time `json:"end_time"`
	Seats      *Seats    `json:"seats"`
}

// Seats represents the theater seats
type Seats struct {
	Rows        int            `json:"rows"`
	SeatsPerRow int            `json:"seats_per_row"`
	Occupied    []SeatPosition `json:"occupied"`
}

// SeatPosition represents a seat position
type SeatPosition struct {
	Row       int    `json:"row"`
	Seat      int    `json:"seat"`
	VisitorID string `json:"visitor_id,omitempty"`
}

// Visitor represents a user in the screening
type Visitor struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	ScreeningID string        `json:"screening_id"`
	Seat        *SeatPosition `json:"seat,omitempty"`
	LastActive  time.Time     `json:"last_active"`
}

// WebSocketMessage represents a message sent over WebSocket
type WebSocketMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// Global variables
var (
	config     Config
	screenings = make(map[string]*Screening)
	visitors   = make(map[string]*Visitor)
	clients    = make(map[*websocket.Conn]string) // WebSocket connection -> visitor ID
	upgrader   = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true // Allow all origins in development
		},
	}
)

func main() {
	// Load configuration
	loadConfig()

	// Initialize default screening
	initDefaultScreening()

	// Set up Gin router
	router := gin.Default()

	// Serve static files
	router.Use(static.Serve("/", static.LocalFile(config.StaticFolder, false)))

	// API routes
	api := router.Group("/api")
	{
		// Authentication
		api.POST("/auth/visitor", createVisitorToken)

		// Screenings
		screeningsAPI := api.Group("/screenings")
		screeningsAPI.GET("/:id", getScreening)
		screeningsAPI.POST("/:id/seats", selectSeat)
		screeningsAPI.POST("/:id/seats/release", releaseSeat)
		screeningsAPI.POST("/:id/heartbeat", heartbeat)
	}

	// WebSocket handler
	router.GET("/ws/screenings/:id", handleWebSocket)

	// Start cleanup routine
	go cleanupInactiveVisitors()

	// Start server
	log.Printf("Starting server on port %s", config.ServerPort)
	if err := router.Run(":" + config.ServerPort); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// Load configuration from file or environment variables
func loadConfig() {
	config.JWTSecret = getEnv("JWT_SECRET", "virtuaplex-secret-key-change-in-production")
	config.ServerPort = getEnv("PORT", "8080")
	config.StaticFolder = getEnv("STATIC_FOLDER", "./static")
}

// Get environment variable with fallback
func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

// Initialize default screening
func initDefaultScreening() {
	screeningID := "default"
	screenings[screeningID] = &Screening{
		ID:         screeningID,
		Title:      "Big Buck Bunny",
		MagnetLink: "magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fbig-buck-bunny.torrent",
		StartTime:  time.Now(),
		EndTime:    time.Now().Add(24 * time.Hour), // Make it last a full day
		Seats: &Seats{
			Rows:        5,
			SeatsPerRow: 10,
			Occupied:    []SeatPosition{},
		},
	}
}

// Create a visitor token
func createVisitorToken(c *gin.Context) {
	var request struct {
		ScreeningID string `json:"screening_id" binding:"required"`
		VisitorName string `json:"visitor_name" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	/* Check if screening exists - use default if user-supplied screening doesn't exist
	screening, exists := screenings[request.ScreeningID]
	if !exists {
		screening = screenings["default"]
		request.ScreeningID = "default"
	}*/

	// Create a new visitor
	visitorID := uuid.New().String()
	visitors[visitorID] = &Visitor{
		ID:          visitorID,
		Name:        request.VisitorName,
		ScreeningID: request.ScreeningID,
		LastActive:  time.Now(),
	}

	// Create JWT token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":          visitorID,
		"name":         request.VisitorName,
		"screening_id": request.ScreeningID,
		"iat":          time.Now().Unix(),
		"exp":          time.Now().Add(3 * time.Hour).Unix(),
	})

	tokenString, err := token.SignedString([]byte(config.JWTSecret))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not generate token"})
		return
	}

	// Broadcast visitor joined event
	broadcastToScreening(request.ScreeningID, WebSocketMessage{
		Type: "visitor_joined",
		Data: gin.H{
			"visitor": gin.H{
				"id":   visitorID,
				"name": request.VisitorName,
			},
		},
	})

	c.JSON(http.StatusOK, gin.H{
		"token":      tokenString,
		"visitor_id": visitorID,
	})
}

// Get screening details
func getScreening(c *gin.Context) {
	// Verify token
	visitorID, err := verifyToken(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	screeningID := c.Param("id")

	// If screening doesn't exist, use default
	screening, exists := screenings[screeningID]
	if !exists {
		screening = screenings["default"]
		screeningID = "default"
	}

	// Update visitor's last active time
	visitor := visitors[visitorID]
	visitor.LastActive = time.Now()

	c.JSON(http.StatusOK, screening)
}

// Select a seat
func selectSeat(c *gin.Context) {
	// Verify token
	visitorID, err := verifyToken(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	screeningID := c.Param("id")

	// Parse request
	var request struct {
		RowNumber  int `json:"row_number" binding:"required"`
		SeatNumber int `json:"seat_number" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// If screening doesn't exist, use default
	screening, exists := screenings[screeningID]
	if !exists {
		screening = screenings["default"]
		screeningID = "default"
	}

	// Check if seat is valid
	if request.RowNumber < 0 || request.RowNumber >= screening.Seats.Rows ||
		request.SeatNumber < 0 || request.SeatNumber >= screening.Seats.SeatsPerRow {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid seat"})
		return
	}

	// Check if seat is occupied
	for _, seat := range screening.Seats.Occupied {
		if seat.Row == request.RowNumber && seat.Seat == request.SeatNumber {
			c.JSON(http.StatusConflict, gin.H{"error": "Seat is already occupied"})
			return
		}
	}

	// Get visitor
	visitor := visitors[visitorID]

	// If visitor already has a seat, release it
	if visitor.Seat != nil {
		for i, seat := range screening.Seats.Occupied {
			if seat.VisitorID == visitorID {
				screening.Seats.Occupied = append(screening.Seats.Occupied[:i], screening.Seats.Occupied[i+1:]...)
				break
			}
		}
	}

	// Assign new seat
	newSeat := SeatPosition{
		Row:       request.RowNumber,
		Seat:      request.SeatNumber,
		VisitorID: visitorID,
	}
	screening.Seats.Occupied = append(screening.Seats.Occupied, newSeat)
	visitor.Seat = &newSeat
	visitor.LastActive = time.Now()

	// Broadcast seat update
	broadcastToScreening(screeningID, WebSocketMessage{
		Type: "seat_update",
		Data: screening.Seats,
	})

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"seat":    newSeat,
	})
}

// Release a seat
func releaseSeat(c *gin.Context) {
	// Verify token
	visitorID, err := verifyToken(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	screeningID := c.Param("id")

	// If screening doesn't exist, use default
	screening, exists := screenings[screeningID]
	if !exists {
		screening = screenings["default"]
		screeningID = "default"
	}

	// Get visitor
	visitor := visitors[visitorID]

	// If visitor has a seat, release it
	if visitor.Seat != nil {
		for i, seat := range screening.Seats.Occupied {
			if seat.VisitorID == visitorID {
				screening.Seats.Occupied = append(screening.Seats.Occupied[:i], screening.Seats.Occupied[i+1:]...)
				break
			}
		}
		visitor.Seat = nil
		visitor.LastActive = time.Now()

		// Broadcast seat update
		broadcastToScreening(screeningID, WebSocketMessage{
			Type: "seat_update",
			Data: screening.Seats,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
	})
}

// Heartbeat to keep visitor active
func heartbeat(c *gin.Context) {
	// Verify token
	visitorID, err := verifyToken(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Update visitor's last active time
	visitor := visitors[visitorID]
	visitor.LastActive = time.Now()

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Handle WebSocket connections
func handleWebSocket(c *gin.Context) {
	screeningID := c.Param("id")

	// If screening doesn't exist, use default
	_, exists := screenings[screeningID]
	if !exists {
		screeningID = "default"
	}

	// Upgrade HTTP connection to WebSocket
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("Failed to upgrade to WebSocket: %v", err)
		return
	}

	// WebSocket connection will be authenticated after receiving the first message
	// which should contain the authentication token

	// Set up clean-up when connection is closed
	defer func() {
		// If connection is authenticated, clean up visitor data
		if visitorID, ok := clients[conn]; ok {
			// Get visitor
			visitor, exists := visitors[visitorID]
			if exists {
				// If visitor has a seat, release it
				if visitor.Seat != nil {
					// Get screening
					screening, screeningExists := screenings[visitor.ScreeningID]
					if screeningExists {
						for i, seat := range screening.Seats.Occupied {
							if seat.VisitorID == visitorID {
								screening.Seats.Occupied = append(screening.Seats.Occupied[:i], screening.Seats.Occupied[i+1:]...)
								break
							}
						}

						// Broadcast seat update
						broadcastToScreening(visitor.ScreeningID, WebSocketMessage{
							Type: "seat_update",
							Data: screening.Seats,
						})
					}
				}

				// Broadcast visitor left event
				broadcastToScreening(visitor.ScreeningID, WebSocketMessage{
					Type: "visitor_left",
					Data: gin.H{
						"visitor_id": visitorID,
					},
				})
			}

			// Remove client from map
			delete(clients, conn)
		}

		conn.Close()
	}()

	// Listen for messages
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("WebSocket read error: %v", err)
			break
		}

		// Parse message
		var wsMessage WebSocketMessage
		if err := json.Unmarshal(message, &wsMessage); err != nil {
			log.Printf("Failed to parse WebSocket message: %v", err)
			continue
		}

		// Handle message based on type
		switch wsMessage.Type {
		case "authenticate":
			// Authenticate the WebSocket connection
			tokenData, ok := wsMessage.Data.(map[string]interface{})
			if !ok {
				sendError(conn, "Invalid authentication data")
				continue
			}

			tokenString, ok := tokenData["token"].(string)
			if !ok {
				sendError(conn, "Invalid token")
				continue
			}

			token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
				return []byte(config.JWTSecret), nil
			})

			if err != nil || !token.Valid {
				sendError(conn, "Invalid token")
				continue
			}

			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				sendError(conn, "Invalid token claims")
				continue
			}

			visitorID, ok := claims["sub"].(string)
			if !ok {
				sendError(conn, "Invalid visitor ID in token")
				continue
			}

			tokenScreeningID, ok := claims["screening_id"].(string)
			if !ok || (tokenScreeningID != screeningID && screeningID != "default") {
				sendError(conn, "Token not valid for this screening")
				continue
			}

			// Store the WebSocket connection with the visitor ID
			clients[conn] = visitorID

			// Update visitor's last active time
			visitor := visitors[visitorID]
			visitor.LastActive = time.Now()

			// Send success response
			if err := conn.WriteJSON(WebSocketMessage{
				Type: "authenticated",
				Data: gin.H{"success": true},
			}); err != nil {
				log.Printf("Failed to send WebSocket message: %v", err)
			}

		case "webrtc_signal":
			// Forward WebRTC signal to target visitor
			if visitorID, ok := clients[conn]; ok {
				// Get data from message
				signalData, ok := wsMessage.Data.(map[string]interface{})
				if !ok {
					sendError(conn, "Invalid signal data")
					continue
				}

				targetID, ok := signalData["target"].(string)
				if !ok {
					sendError(conn, "Invalid target ID")
					continue
				}

				// Find target connection
				var targetConn *websocket.Conn
				for conn, id := range clients {
					if id == targetID {
						targetConn = conn
						break
					}
				}

				if targetConn == nil {
					sendError(conn, "Target visitor not found")
					continue
				}

				// Add sender ID to data
				signalData["from"] = visitorID

				// Forward message to target
				if err := targetConn.WriteJSON(WebSocketMessage{
					Type: "webrtc_signal",
					Data: signalData,
				}); err != nil {
					log.Printf("Failed to send WebSocket message: %v", err)
				}
			} else {
				sendError(conn, "Not authenticated")
			}

		case "heartbeat":
			// Update visitor's last active time
			if visitorID, ok := clients[conn]; ok {
				visitor := visitors[visitorID]
				visitor.LastActive = time.Now()
			} else {
				sendError(conn, "Not authenticated")
			}
		}
	}
}

// Send error message over WebSocket
func sendError(conn *websocket.Conn, message string) {
	if err := conn.WriteJSON(WebSocketMessage{
		Type: "error",
		Data: gin.H{"message": message},
	}); err != nil {
		log.Printf("Failed to send WebSocket error message: %v", err)
	}
}

// Verify JWT token from Authorization header
func verifyToken(c *gin.Context) (string, error) {
	tokenString := c.GetHeader("Authorization")
	if tokenString == "" {
		return "", fmt.Errorf("token missing")
	}

	// Remove "Bearer " prefix if present
	if len(tokenString) > 7 && tokenString[:7] == "Bearer " {
		tokenString = tokenString[7:]
	}

	// Parse the token
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return []byte(config.JWTSecret), nil
	})

	if err != nil {
		return "", fmt.Errorf("invalid token: %w", err)
	}

	if !token.Valid {
		return "", fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", fmt.Errorf("invalid token claims")
	}

	visitorID, ok := claims["sub"].(string)
	if !ok {
		return "", fmt.Errorf("invalid visitor ID in token")
	}

	// Check if visitor exists
	if _, exists := visitors[visitorID]; !exists {
		return "", fmt.Errorf("visitor not found")
	}

	return visitorID, nil
}

// Broadcast a message to all clients in a screening
func broadcastToScreening(screeningID string, message WebSocketMessage) {
	for conn, visitorID := range clients {
		visitor, exists := visitors[visitorID]
		if exists && visitor.ScreeningID == screeningID {
			if err := conn.WriteJSON(message); err != nil {
				log.Printf("Failed to send WebSocket message: %v", err)
			}
		}
	}
}

// Clean up inactive visitors periodically
func cleanupInactiveVisitors() {
	for {
		time.Sleep(1 * time.Minute)

		now := time.Now()
		for visitorID, visitor := range visitors {
			// If visitor has been inactive for more than 5 minutes
			if now.Sub(visitor.LastActive) > 5*time.Minute {
				// If visitor has a seat, release it
				if visitor.Seat != nil {
					screening, exists := screenings[visitor.ScreeningID]
					if exists {
						for i, seat := range screening.Seats.Occupied {
							if seat.VisitorID == visitorID {
								screening.Seats.Occupied = append(screening.Seats.Occupied[:i], screening.Seats.Occupied[i+1:]...)
								break
							}
						}

						// Broadcast seat update
						broadcastToScreening(visitor.ScreeningID, WebSocketMessage{
							Type: "seat_update",
							Data: screening.Seats,
						})
					}
				}

				// Broadcast visitor left event
				broadcastToScreening(visitor.ScreeningID, WebSocketMessage{
					Type: "visitor_left",
					Data: gin.H{
						"visitor_id": visitorID,
					},
				})

				// Remove visitor from map
				delete(visitors, visitorID)

				// Close any connected WebSockets
				for conn, id := range clients {
					if id == visitorID {
						conn.Close()
						delete(clients, conn)
					}
				}
			}
		}
	}
}
