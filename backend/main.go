package main 

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type User struct {
	Connection 	*websocket.Conn
	Color		string 
}
type Room struct {
	Connections     []*User
	Drawings	[][]byte
	CreatedAt	time.Time
	mu 		sync.RWMutex
}
type DrawMessage struct {
	Type	string	`json:"type"`
	X	float64 `json:"x"`
	Y	float64 `json:"y"`
	Color 	string  `json:"color"`
	Width 	int 	`json:"width"`
}
type CursorMessage struct {
	X	float64 `json:"x"`
	Y	float64 `json:"y"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool{ return true },
}

var (
	rooms = make(map[string]*Room)
	roomsMutex sync.RWMutex
)

func main() {
	http.HandleFunc("/room", handler)
}

func handler(w http.ResponseWriter, r *http.Request) {

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return 
	}
	defer conn.Close()

	user := &User{
		Connection: 	conn,
		Color:		getRandomHex(),	 
	}

	room, err := joinRoom(r.URL.Query().Get("room"), user)	
	if err != nil {
		log.Println("cannot connect to room")
		return 
	}

	run(conn, room, user)
}

func joinRoom(roomCode string, user *User) (*Room, error) {
	if roomCode == "" || len(roomCode) != 6 {
		return nil, errors.New("room code invalid")
	}

	roomsMutex.Lock()
	defer roomsMutex.Unlock()

	if rooms[roomCode] == nil {
		rooms[roomCode] = &Room{ 
			Connections: 	[]*User{},
			Drawings: 	[][]byte{},
			CreatedAt: 	time.Now(), 
		}
	}

	room := rooms[roomCode]

	room.mu.Lock()
	room.Connections = append(room.Connections, user)
	room.mu.Unlock()
	
	return room, nil 
}

func run(conn *websocket.Conn, room *Room, user *User) {

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println(err)
			break // conn dead
		}

		var data map[string]interface{}
		err = json.Unmarshal(msg, &data)
		if err != nil {
			log.Println(err)
			continue // Skip msg
		}

		messageType, ok := data["type"].(string)
		if !ok {
			continue
		}

		switch messageType {
		case "draw":
			var drawMsg DrawMessage
			err = json.Unmarshal(msg, &drawMsg)
			if err != nil {
				continue
			}
			
			// handle drawing

		case "cursor":
			var cursorMsg CursorMessage
			err = json.Unmarshal(msg, &cursorMsg)
			if err != nil {
				continue
			}
			// handle curesor 
		default:
			log.Println("Unknown msg:", messageType)
		}
	}



}

func getRandomHex() string{
	return "#444444"
}
