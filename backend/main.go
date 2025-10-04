package main
import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type User struct {
	Connection 	*websocket.Conn
	Color		string 
	LastCursorTime 	time.Time
}
type Room struct {
	Connections     []*User
	Drawings	[][]byte
	LastActive	time.Time
	mu 		sync.RWMutex
}


var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool{ return true },
}

var (
	rooms = make(map[string]*Room)
	roomsMutex sync.RWMutex
)

func main() {
	http.Handle("/", http.FileServer(http.Dir("./frontend")))
	http.HandleFunc("/ws", handler)

	go cleanupRooms()

	log.Println("WebSocket server started on :8080")
	err := http.ListenAndServe(":8080", nil)
	if err != nil {
		fmt.Println("Error starting server:", err)
	}
}

// handler: Upgrades to websocket then connection joins room
func handler(w http.ResponseWriter, r *http.Request) {

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Error upgrading connection - ", err)
		return 
	}
	defer conn.Close()

	user := &User{
		Connection: 	conn,
		Color:		getRandomHex(),	 
	}
	
	roomCode := r.URL.Query().Get("room")
	room, err := joinRoom(roomCode, user)	
	if err != nil {
		log.Printf("Error: Connection to room (%s) - %v", roomCode, err)
		return 
	}

	run(conn, room, user)
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
			Connections: 	[]*User{},
			Drawings: 	[][]byte{},
			LastActive: 	time.Now(), 
		}
	}

	room := rooms[roomCode]

	room.mu.Lock()
	room.Connections = append(room.Connections, user)
	room.mu.Unlock()

	return room, nil 
}

// Leave room: remove user from room connections.
func leaveRoom(room *Room, user *User) {

	if room == nil {
		return
	}

	room.mu.Lock()
	// slice removal seems messy, but users in room will not be large 
	for i, v := range room.Connections {
		if v == user {
			room.Connections = append(room.Connections[:i], room.Connections[i+1:]...)
			break
		}
	}

	log.Println("User: has left room %v - connections left %d", room, len(room.Connections))

	room.LastActive = time.Now()
	room.mu.Unlock()
}

// run: Message loop for websocket.
func run(conn *websocket.Conn, room *Room, user *User) {

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println("Error: Reading message", err)
			leaveRoom(room, user)
			break // conn dead
		}

		var data map[string]interface{}
		err = json.Unmarshal(msg, &data)
		if err != nil {
			log.Println("Error: Converting msg to json -", err)
			continue // Skip msg
		}

		log.Println()

		messageType, ok := data["type"].(string)
		if !ok {
			continue
		}

		switch messageType {
		case "draw":

			room.mu.Lock()
			room.Drawings = append(room.Drawings, msg)
			room.LastActive = time.Now()
			room.mu.Unlock()

			broadcast(room, msg, user.Connection)


		case "cursor":

			data["color"] = user.Color

			if time.Since(user.LastCursorTime) < 33*time.Millisecond {
				continue // Throttle cursor msgs
			}

			msgWithColor, err := json.Marshal(data)
			if err != nil {
				continue
			}

			broadcast(room, msgWithColor, user.Connection)

		default:
			log.Println("Unknown msg:", messageType)
		}
	}

}

// broadcast: write message to all users in room connection. 
func broadcast(room *Room, msg[]byte, sender *websocket.Conn) {

	room.mu.Lock()
	defer room.mu.Unlock()

	for _, user := range room.Connections {
		// Skip sender to avoid echo
		if user.Connection == sender {
			continue
		}
			
		err := user.Connection.WriteMessage(websocket.TextMessage, msg)
		if err != nil {
			leaveRoom(room, user)	// dead conn, clean
		}
	}
}

// cleanupRooms: Routine to delete expired rooms.
func cleanupRooms(){
	ticker := time.NewTicker(15 * time.Minute)
	for range ticker.C {
		roomsMutex.Lock()
		now := time.Now()

		for code, room := range rooms {
			room.mu.RLock()
			expired := (now.Sub(room.LastActive) > 1*time.Hour) && len(room.Connections) == 0 
			room.mu.RUnlock()

			if expired {
				delete(rooms, code)
				log.Println("Room %s expired", code)
			}
		}

		roomsMutex.Unlock()

	}

}

// temporary
func getRandomHex() string{
	return "#444444"
}

