package main

import (
	"sync"
	"log"
	"time"
	"github.com/gorilla/websocket"
)
type User struct {
	id		string
	connection 	*websocket.Conn
	color		string
	lastCursorTime 	time.Time
}
type Room struct {
	connections     []*User
	drawings	map[float64][][]byte
	lastActive	time.Time
	mu 		sync.RWMutex
}

// join: adds user to room, sends existing drawings
func (r *Room) join(u *User) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.connections = append(r.connections, u)

	// send existing drawings
	for _, drawingPoints := range r.drawings {
		for _, point := range drawingPoints {
			u.connection.WriteMessage(websocket.TextMessage, point)
		}
	}
}

func (r *Room) leave(u *User) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i, v := range r.connections {
		if v == u {
			r.connections = append(r.connections[:i], r.connections[i+1:]...)
			break
		}
	}

	r.lastActive = time.Now()
	log.Println("User has left room %v - connections left %d", r, len(r.connections))
}

func (r *Room) broadcast(msg []byte, sender *websocket.Conn) {
	r.mu.RLock()
	connections := make([]*User, len(r.connections))
	copy(connections, r.connections)
	r.mu.RUnlock()
	
	var failed []*User
	for _, u := range connections {
		if u.connection == sender {
			continue
		}

		if err := u .connection.WriteMessage(websocket.TextMessage, msg); err != nil {
			failed = append(failed, u)
		}
	}

	// Remove failed conns
	if len(failed) > 0 {
		r.mu.Lock()
		for _, failedUser := range failed {
			for i, u := range r.connections {
				if u == failedUser {
					r.connections = append(r.connections[:i], r.connections[i+1:]...)
					break
				}
			}
		}
		r.mu.Unlock()
	}
}

