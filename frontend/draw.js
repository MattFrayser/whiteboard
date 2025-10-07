// =======================
// CONFIG
// =======================
const CONFIG = {
    CURSOR_THROTTLE: 60,
    MIN_SCALE: 0.1,
    MAX_SCAL: 10,
    ZOOM_SPEED: 500,
    CLEANUP_INTERVAL: 15 * 60 * 1000
};

// =======================
// DOM REFERENCES 
// =======================
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
const toolbar = document.getElementById('toolbar');
const colorSwatches = document.querySelectorAll('.swatch');
const colorMenu = document.getElementById('colorMenu');
const colorPicker = document.getElementById('colorPicker');
const colorGrid = document.getElementById('colorGrid');
const brushSize = document.getElementById('brushSize');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');

document.oncontextmenu = () => false;

// =======================
// STATE  
// =======================
const drawings = [];
let undoneDrawings = [];
let currStrokeId = null;
let currStroke = null;
let redrawQueued = false;

let myUserId = null;
let remoteCursors = new Map()
let remoteStrokes = new Map()
let lastCursorSend = Date.now()

let mouseX, mouseY, prevMouseX, prevMouseY;
let leftMouseDown = 0, rightMouseDown = 0;

let offsetX = 0, offsetY = 0;
let scale = 1;

let currTool = 'draw'
let currBrushColor = '#000000'
let currBrushWidth = 5; 

// =======================
// COORDINATES 
// =======================
const Coordinates = {

    worldToViewport(point) {
        return {
            x: (point.x + offsetX) * scale, 
            y: (point.y + offsetY) * scale
        };
    },
    viewportToWorld(point) {
        return {
            x: (point.x / scale) - offsetX, 
            y: (point.y / scale) - offsetY
        };
    },
    visibleWorldSize() {
        return {
            width: canvas.clientWidth / scale,
            height: canvas.clientHeight / scale
        };
    }
}

// =======================
// Stroke Class 
// =======================
class Stroke {
    constructor(id, userId, color, width, tool) {
        this.id = id;
        this.userId = userId;
        this.points = [];
        this.color = color;
        this.width = width;
        this.tool = tool;
    }
    
    addPoint(x, y) {
        this.points.push({x,y})
    }

    draw(context, scale, offsetX, offsetY) {
        if (this.points.length === 1) {
            this.drawDot(context, scale, offsetX, offsetY)
        } else {
            this.drawLine(context, scale, offsetX, offsetY)
        }
    }
    drawDot(context, scale, offsetX, offsetY) {
        if (this.points.length === 1) {
            const point = Coordinates.worldToViewport(this.points[0]);
            context.beginPath();
            context.arc(point.x, point.y, this.width * scale / 2, 0, Math.PI * 2);
            context.fillStyle = this.color;
            context.fill();
            return;
        }
    }
    drawLine(context, scale, offsetX, offsetY) {
        if (this.points.length < 1) return;

        context.beginPath();
        context.strokeStyle = this.color;
        context.lineWidth = this.width * scale;
        context.lineJoin = 'round';
        context.lineCap = 'round';

        if (this.isEraser) {
            context.globalCompositeOperation = 'destination-out';
        } else {
            context.globalCompositeOperation = 'source-over';
        }

        const firstPoint = Coordinates.worldToViewport(this.points[0]);
        context.moveTo(firstPoint.x, firstPoint.y);

        // Quadratic curves for smooth lines
        for (let i = 1; i < this.points.length - 1; i++) {
            const p1 = Coordinates.worldToViewport(this.points[i]);
            const p2 = Coordinates.worldToViewport(this.points[i + 1]);  // ✓ FIXED
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            context.quadraticCurveTo(p1.x, p1.y, midX, midY);
        }

        if (this.points.length > 1) {
            const lastPoint = Coordinates.worldToViewport(this.points[this.points.length - 1]);
            context.lineTo(lastPoint.x, lastPoint.y);
        }

        context.stroke();
        context.globalCompositeOperation = 'source-over';
   }

  }

// =======================
// DRAWING 
// =======================
const Drawing = {
    requestRedraw() {
        if (!redrawQueued) {
            redrawQueued = true;
            requestAnimationFrame(() => {
                this.redraw();
                redrawQueued = false;
            });
        }
    },

    redraw() {
        canvas.width = document.body.clientWidth;
        canvas.height = document.body.clientHeight;

        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        for (let stroke of drawings) {
            stroke.draw(context, scale, offsetX, offsetY)
        }

        if (currStroke) {
            currStroke.draw(context, scale, offsetX, offsetY)
        }
        
        this.drawRemoteCursors();
    },

    drawRemoteCursors() {
        remoteCursors.forEach((cursor) => {
            const viewportPos = Coordinates.worldToViewport({x: cursor.x, y: cursor.y});

            // Draw colored circle
            context.beginPath();
            context.arc(viewportPos.x, viewportPos.y, 8, 0, Math.PI * 2);
            context.fillStyle = cursor.color;
            context.fill();
            context.strokeStyle = 'white';
            context.lineWidth = 2;
            context.stroke();
        });
    }
}

// =======================
// Mouse Movement
// =======================
const Mouse = {
    onDown(event) {
        if (event.button === 0) {
            currStrokeId = Math.floor(Date.now() + Math.random());
            leftMouseDown = true;
            rightMouseDown = false;
            mouseX = event.pageX;
            mouseY = event.pageY;

            const worldPos = Coordinates.viewportToWorld({x: mouseX, y: mouseY});
            currStroke = new Stroke(
                currStrokeId,
                myUserId,
                [worldPos],
                currBrushColor,
                currBrushWidth,
                currTool === 'erase'
            );
            currStroke.addPoint(worldPos.x, worldPos.y);
            Drawing.requestRedraw();
        }

        if (event.button === 2) {
            rightMouseDown = true
            leftMouseDown = false
            mouseX = event.pageX;
            mouseY = event.pageY;
            prevMouseX = event.pageX;
            prevMouseY = event.pageY;
            this.updateCursor();
        }
    },

    onMove(event) {
        mouseX = event.pageX;
        mouseY = event.pageY;

        const worldPos = Coordinates.viewportToWorld({x: mouseX, y: mouseY});
        const now = Date.now();

        if (now - lastCursorSend > CONFIG.CURSOR_THROTTLE) {
            WebSocketManager.send({
                type: 'cursor',
                x: worldPos.x,
                y: worldPos.y
            });
            lastCursorSend = now;
        } 

        if (leftMouseDown && currStroke) {
            currStroke.addPoint(worldPos.x, worldPos.y);
            
            WebSocketManager.send({
                type: 'draw',
                id: currStrokeId,
                x: worldPos.x,
                y: worldPos.y,
                color: currBrushColor,
                width: currBrushWidth,
                isEraser: currTool === 'erase'
            });
            Drawing.requestRedraw();
        }

        if (rightMouseDown) {
            offsetX += (mouseX - prevMouseX) / scale;
            offsetY += (mouseY - prevMouseY) / scale;
            Drawing.requestRedraw();
            prevMouseX = mouseX;
            prevMouseY = mouseY;
        }
    },

    onUp() {
        if (leftMouseDown && currStroke) {
            drawings.push(currStroke);
            currStroke = null;

            // Only clear redo stack for current user's strokes
            undoneDrawings = undoneDrawings.filter(s => s.userId !== myUserId)
            Toolbar.updateUndoRedoButtons()
        }
        leftMouseDown = false;
        rightMouseDown = false;
        this.updateCursor()
    },

    onWheel(event) {
        const deltaY = event.deltaY;
        const scaleAmount = -deltaY / CONFIG.ZOOM_SPEED;
        scale = Math.max(CONFIG.MIN_SCALE, Math.min(CONFIG.MAX_SCALE, scale * (1 + scaleAmount)));

        const distX = event.pageX / canvas.clientWidth;
        const distY = event.pageY / canvas.clientHeight;

        const worldSize = visibleWorldSize();
        const unitsZoomedX = worldSize.width * scaleAmount;
        const unitsZoomedY = worldSize.height * scaleAmount;

        offsetX -= unitsZoomedX * distX;
        offsetY -= unitsZoomedY * distY;

        Drawing.requestRedraw();
    },

    updateCursor() {
            canvas.style.cursor = rightMouseDown ? 'grabbing' : 'crosshair';
    }
};

// =======================
// TOOLBAR 
// =======================
const Toolbar = {
    activeSwatchForMenu: null,
    activeSwatch: colorSwatches[0],
    clickTimers: new Map(),

    colors: [
        '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00',
        '#FF00FF', '#00FFFF', '#800000', '#008000', '#000080', '#808000',
        '#800080', '#008080', '#C0C0C0', '#808080', '#FFA500', '#A52A2A',
        '#FFC0CB', '#FFD700', '#4B0082', '#9370DB', '#90EE90', '#FF6347'
    ],

    init() {
        this.initColorGrid();
        this.initEventListeners();
    },

    initColorGrid() {
        this.colors.For
    },

    initEventListeners() {
    
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.color-picker-container')) {
                this.closeMenu();
            }
        });

        colorGrid.addEventListener('click', (e) => {
            if (e.target.classList.contains('color-option')) {
                this.selectColor(e.target.dataset.color);
                this.closeMenu();
            }
        });

        colorPicker.addEventListener('input', (e) => selectColor(e.target.value));

        colorMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });



        colorSwatches.forEach(swatch => {
            swatch.addEventListener('click', (e) => {
                const color = swatch.dataset.color;
                
                if (clickTimers.has(swatch)) {
                    clearTimeout(clickTimers.get(swatch));
                    this.clickTimers.delete(swatch);
                    this.openMenu(swatch);
                } else {
                    const timer = setTimeout(() => {
                        this.selectColor(color);
                        this.selectBrushSize(size);
                        this.clickTimers.delete(swatch);
                    }, 250);
                    this.clickTimers.set(swatch, timer);
                }
            });
        });
    
        brushSize.addEventListener('input', (e) => {
            this.selectBrushSize(parseInt(e.target.value));
        });

        undoBtn.addEventListener('click', () => this.undo())
        redoBtn.addEventListener('click', () => this.redo())
    },

    selectColor(color) {
        currBrushColor = color;
        
        if (this.activeSwatch) {
            this.activeSwatch.classList.remove('active');
        }
        
        let matchingSwatch = null;
        for (const swatch of colorSwatches) {
            if (swatch.dataset.color.toUpperCase() === color.toUpperCase()) {
                matchingSwatch = swatch;
                break;
            }
        }
        
        if (matchingSwatch) {
            this.activeSwatch = matchingSwatch;
        } else if (this.activeSwatchForMenu) {
            const circle = activeSwatchForMenu.querySelector('.swatch-circle');
            if (circle) {
                circle.style.background = color;
            }
            this.activeSwatchForMenu.dataset.color = color;
            this.activeSwatch = activeSwatchForMenu;
        }
        
        if (this.activeSwatch) {
            this.activeSwatch.classList.add('active');
            this.updateBrushPreview();   
        }
    },

    selectBrushSize(size) {
        currBrushWidth = size;
        brushSize.value = currBrushWidth;
        
        if (this.activeSwatch) {
            this.activeSwatch.dataset.size = currBrushWidth;
        }
        
        this.updateBrushPreview();
    },

    updateBrushPreview() {
        if (this.activeSwatch) {
            const circle = activeSwatch.querySelector('.swatch-circle');
            if (circle) {
                const size = Math.min(36, Math.max(8, currBrushWidth * 1.5));
                circle.style.width = size + 'px';
                circle.style.height = size + 'px';
            }
        }
    },

    openMenu(swatch) {
        this.activeSwatchForMenu = swatch;
        colorMenu.classList.remove('hidden');
        colorPicker.value = currBrushColor;
        const swatchSize = parseInt(swatch.dataset.size) || currBrushWidth;
        this.selectBrushSize(swatchSize);
    },

    closeMenu() {
        colorMenu.classList.add('hidden');
        this.activeSwatchForMenu = null;
    },

    undo() {
        // Find last stroke by current user
        for (let i = drawings.length - 1; i >= 0; i--) {
            if (drawings[i].userId === myUserId) {
                const stroke = drawings.splice(i, 1)[0]
                undoneDrawings.push(stroke)
                WebSocketManager.send({
                    type:'undo',
                    id: stroke.id,
                });
                this.updateUndoRedoButtons();
                Drawing.requestRedraw();
                return;
            }
        }
    },

    redo() {
        if (undoneDrawings.length > 0) {
            const stroke = undoneDrawings.pop()
            drawings.push(stroke)

            WebSocketManager.send({
                type: 'redo',
                id: stroke.id,
                points: stroke.points,
                color: stroke.color,
                width: stroke.width,
                isEraser: stroke.isEraser,
            });

            this.updateUndoRedoButtons()
            Drawing.requestRedraw()
        }
    },

    updateUndoRedoButtons() {
        undoBtn.disabled = !drawings.some(s => s.userId === myUserId)
        redoBtn.disabled = undoneDrawings.length === 0
    }
}

// =======================
// Keybinds 
// =======================

const Keyboard = {
    init() {
        document.addEventListener('keydown', (e) => this.onKeyDown(3));
    },
    
    onKeyDown(e) {
        // Ctrl+Z (Windows/Linux) or Cmd+Z (Mac)
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault()
            Toolbar.undo()
        }
        // Ctrl+Y (Windows/Linux) or Cmd+Shift+Z (Mac)
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            Toolbar.redo();
        }
    }
};

// =======================
// WEBSOCKET
// =======================
const WebSocketManager = {
    socket: null,
    
    init(roomCode) {
        this.socket = new WebSocket(`ws://localhost:8080/ws?room=${roomCode}`)

        this.socket.onopen = () => {
            console.log("websocket con success")
            WebSocketManager.send({ type: 'getUserId' })
        };

        this.socket.onmessage = (event) => this.onMessage(event);
    },

    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        }
    },

    onMessage(event) {
    
        const data = JSON.parse(event.data);

        switch (data.type) {
            case 'userId':
                myUserId = data.userId;
                break;
            case 'draw':
                this.handleDraw(data)
                break;
            case 'cursor':
                this.handleCursor(data)
                break;
            case 'undo':
                this.handleUndo(data)
                break;
            case 'redo':
                this.handleRedo(data)
                break;
        }
    },

    handleDraw(data) {
        let stroke = remoteStrokes.get(data.id);

        if (!stroke) {
            stroke = new Stroke(
                data.id,
                data.userId,
                data.color,
                data.width,
                data.tool
            );
            remoteStrokes.set(data.id, stroke);
            drawings.push(stroke);
        }

        stroke.addPoint(data.x, data.y);
        Drawing.requestRedraw();
    },
    handleUndo(data) {
        const index = drawings.findIndex(s => s.id === data.id)
        if (index !== -1) {
            drawings.splice(index, 1)
            remoteStrokes.delete(data.id)
        }
        Drawing.requestRedraw()
    },
    handleRedo(data) {
        const stroke = new Stroke(
            data.id,
            data.userId,
            data.color,
            data.width,
            data.tool
        );
        data.points.forEach(p => stroke.addPoint(p.x, p.y));
        remoteStrokes.set(data.id, stroke);
        drawings.push(stroke);
        Drawing.requestRedraw();
    },
    handleCursor(data) {
       remoteCursors.set(data.connectionId, {
            x: data.x, 
            y: data.y,
            color: data.color
        });
        Drawing.requestRedraw();
    }
};

// =======================
// ROOM 
// =======================

const Room = {
generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
},

getCode() {
    const urlParams = new URLSearchParams(window.location.search);
    let roomCode = urlParams.get('room');

    if (!roomCode) {
        roomCode = self.generateCode();
        window.history.replaceState({}, '', `?room=${roomCode}`);
    }

    return roomCode;
    }
};

// =======================
// init 
// =======================
function init() {
    Toolbar.init();
    Keyboard.init();
    canvas.addEventListener('mousedown', (e) => Mouse.onDown(e));
    canvas.addEventListener('mousemove', (e) => Mouse.onMove(e));
    canvas.addEventListener('mouseup', () => Mouse.onUp());
    canvas.addEventListener('wheel', (e) => Mouse.onWheel(e));
    window.addEventListener("resize", () => Drawing.requestRedraw());

    Drawing.redraw();
    Mouse.updateCursor();

    const roomCode = Room.getCode();
    WebSocketManager.init(roomCode);
}

init();
