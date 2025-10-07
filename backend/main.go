package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)


var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool{ return true },
}

var (
	rooms = make(map[string]*Room)
	roomsMutex sync.RWMutex
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	http.Handle("/", http.FileServer(http.Dir("./frontend")))
	http.HandleFunc("/ws", handleWebSocket)

	go cleanupRooms(ctx)

	log.Println("WebSocket server started on :8080")
	err := http.ListenAndServe(":8080", nil)
	if err != nil {
		log.Fatalf("Error starting server: ", err)
	}
}

// handleWebSocket: Upgrades http to websocket then joins room
func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("Error upgrading connection - ", err)
		return
	}
	defer conn.Close()

	u := &User{
		id:         fmt.Sprintf("%d", time.Now().UnixNano()),
		connection: conn,
		color:      getRandomHex(),
	}

	roomCode := r.URL.Query().Get("room")
	room, err := joinRoom(roomCode, u)
	if err != nil {
		fmt.Println("Error: Connection to room (%s) - %v", roomCode, err)
		return
	}

	run(conn, room, u)
}

// joinRoom: Add connection to room based on room code.
func joinRoom(roomCode string, user *User) (*Room, error) {
	if roomCode == "" {
		return nil, errors.New("Error: room code missing")
	}

	roomsMutex.Lock()
	defer roomsMutex.Unlock()

	if rooms[roomCode] == nil {
		rooms[roomCode] = &Room{
			connections: []*User{},
			drawings:    make(map[float64][][]byte),
			lastActive:  time.Now(),
		}
	}

	room := rooms[roomCode]

	room.join(user)
	return room, nil
}

// run: Message loop for websocket.
func run(conn *websocket.Conn, room *Room, user *User) {

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println("Error: Reading message", err)
			room.leave(user)
			break // conn dead
		}

	     	if err := handleMessage(room, user, msg); err != nil {	
			log.Println("error: Converting msg to json -", err)
			continue // Skip msg
		}
	}
}

func handleMessage(room *Room, user *User, msg []byte) error {
	var data map[string]interface{}
	if err := json.Unmarshal(msg, &data); err != nil {
		return fmt.Errorf("unmarshal base message: %w", err)
	}

	messageType, ok := data["type"].(string)
	if !ok {
		return fmt.Errorf("missing message type")
	}
	switch messageType {
	case "getUserId":
		return handleGetUserID(user)
	case "draw":
		return handleDraw(room, user, data)
	case "cursor":
		return handleCursor(room, user, data)
	case "undo":
		return handleUndo(room, user, data, msg)
	case "redo":
		return handleRedo(room, user, data, msg)
	default:
		return fmt.Errorf("unknown message type: %s", messageType)
	}
}

func handleGetUserID(user *User) error {
	response := map[string]interface{}{
		"type":    "userId",
		"userId":  user.id,
	}

	responseMsg, err := json.Marshal(response)
	if err != nil {
		return fmt.Errorf("marshal user ID response: %w", err)
	}

	return user.connection.WriteMessage(websocket.TextMessage, responseMsg)
}

func handleDraw(room *Room, user *User, data map[string]interface{}) error {
	id, ok := data["id"].(float64)
	if !ok {
		return fmt.Errorf("missing stroke id")
	}

	// Add user id to message
	data["userId"] = user.id
	msgWithUser, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshall draw message: %w", err)
	}

	room.mu.Lock()
	room.drawings[id] = append(room.drawings[id], msgWithUser)
	room.lastActive = time.Now()
	room.mu.Unlock()

	room.broadcast(msgWithUser, user.connection)
	return nil
}

func handleCursor(room *Room, user *User, data map[string]interface{}) error {
	if time.Since(user.lastCursorTime) < 33*time.Millisecond {
		return nil // throttle
	}

	user.lastCursorTime = time.Now()
	data["color"] = user.color

	msg, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal cursor message: %w", err)
	}

	room.broadcast(msg, user.connection)
	return nil
}

func handleUndo(room *Room, user *User, data map[string]interface{}, msg []byte) error {
	id, ok := data["id"].(float64)
	if !ok {
		return fmt.Errorf("missing stroke id")
	}

	room.mu.Lock()
	delete(room.drawings, id)
	room.lastActive = time.Now()
	room.mu.Unlock()

	room.broadcast(msg, user.connection)
	return nil
}

func handleRedo(room *Room, user *User, data map[string]interface{}, msg []byte) error {
	id, ok := data["id"].(float64)
	if !ok {
		return fmt.Errorf("missing stroke id")
	}

	data["userId"] = user.id
	msgWithUser, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal redo message: %w", err)
	}

	room.mu.Lock()
	room.drawings[id] = [][]byte{msgWithUser}
	room.lastActive = time.Now()
	room.mu.Unlock()

	room.broadcast(msgWithUser, user.connection)
	return nil
}

// cleanupRooms: Routine to delete expired rooms.
func cleanupRooms(ctx context.Context){
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return 
		case <-ticker.C:
			roomsMutex.Lock()
			now := time.Now()

			for code, room := range rooms {
				room.mu.RLock()
				expired := (now.Sub(room.lastActive) > 1*time.Hour) && len(room.connections) == 0
				room.mu.RUnlock()

				if expired {
					delete(rooms, code)
					log.Printf("Room %s expired", code)
				}
			}
			roomsMutex.Unlock()
		}

	}
}

// temporary
func getRandomHex() string{
	return "#444444"
}

