# Whiteboard WebSocket API

A real-time collaborative drawing API built with Go and WebSocket. This documentation covers how to integrate the drawing server into your own projects.

## Installation

### Prerequisites
- Go 1.16 or higher
- Modern web browser with WebSocket support

## API Overview

The WebSocket API uses JSON messages for all communication. Connect to the server at:
```
ws://localhost:8080/ws?room=ROOM_CODE
```

## Connection Flow

1. **Connect to WebSocket** with room code parameter
2. **Request user ID** to identify your connection
3. **Receive existing drawings** automatically on join
4. **Send/receive drawing events** in real-time

## Message Types

### Client to Server

#### Get User ID
Request your unique user identifier after connecting.
```json
{
  "type": "getUserId"
}
```

#### Draw
Send drawing points as the user draws.
```json
{
  "type": "draw",
  "id": 1234567890,
  "x": 100.5,
  "y": 200.5,
  "color": "#FF0000",
  "width": 5,
  "isEraser": false
}
```

#### Cursor Position
Share cursor position with other users.
```json
{
  "type": "cursor",
  "x": 150.0,
  "y": 250.0
}
```

#### Undo Stroke
Remove a stroke from the canvas.
```json
{
  "type": "undo",
  "id": 1234567890
}
```

#### Redo Stroke
Restore a previously undone stroke.
```json
{
  "type": "redo",
  "id": 1234567890,
  "points": [{"x": 100, "y": 100}, {"x": 110, "y": 110}],
  "color": "#FF0000",
  "width": 5,
  "isEraser": false
}
```

### Server to Client

#### User ID Response
Receive your assigned user ID.
```json
{
  "type": "userId",
  "userId": "1234567890123"
}
```

#### Draw Broadcast
Receive drawing updates from other users.
```json
{
  "type": "draw",
  "id": 1234567890,
  "userId": "1234567890123",
  "x": 100.5,
  "y": 200.5,
  "color": "#FF0000",
  "width": 5,
  "isEraser": false
}
```

#### Cursor Broadcast
Receive cursor positions from other users.
```json
{
  "type": "cursor",
  "x": 150.0,
  "y": 250.0,
  "color": "#444444"
}
```

## Room Management

### Creating a Room
Rooms are created automatically when the first user connects with a room code.

### Room Lifecycle
- Rooms persist for 1 hour after the last activity
- Empty rooms are cleaned up every 15 minutes
- All drawing data is stored in memory (not persisted)


## Support

For issues or questions, please file an issue on the project repository.
