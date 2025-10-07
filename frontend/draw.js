const toolbar = document.getElementById('toolbar');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');

document.oncontextmenu = () => false;

const drawings = []
const undoneDrawings = []
let myUserId = null
let currStroke = null
let redrawQueued = false

let mouseX, mouseY, prevMouseX, prevMouseY;
let leftMouseDown = 0, rightMouseDown = 0;
let offsetX = 0, offsetY = 0;
let scale = 1;

let currTool = 'draw'
let currBrushColor = '#000000'
let currBrushWidth = 5; 
let currStrokeId = null;

// =======================
// COORDINATES 
// =======================
function worldToViewport(point) {
    return {
        x: (point.x + offsetX) * scale, 
        y: (point.y + offsetY) * scale
    };
}
function viewportToWorld(point) {
    return {
        x: (point.x / scale) - offsetX, 
        y: (point.y / scale) - offsetY
    };
}
function visibleWorldSize() {
    return {
        width: canvas.clientWidth / scale,
        height: canvas.clientHeight / scale
    };
}

// =======================
// Drawing
// =======================
// throttle redraws
function requestRedraw() {
    if (!redrawQueued) {
        redrawQueued = true;
        requestAnimationFrame(() => {
            redrawCanvas();
            redrawQueued = false;
        });
    }
}

function redrawCanvas() {
    canvas.width = document.body.clientWidth;
    canvas.height = document.body.clientHeight;

    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let stroke of drawings) {
        drawStroke(stroke)
    }

    if (currStroke) {
        drawStroke(currStroke)
    }
}

function drawStroke(stroke) {


    if (stroke.points.length === 1) {
        const point = worldToViewport(stroke.points[0]);
        context.beginPath();
        context.arc(point.x, point.y, stroke.width * scale / 2, 0, Math.PI * 2);
        context.fillStyle = stroke.color;
        context.fill();
        return;
    }
    
    if (stroke.points.length < 1) return;

    context.beginPath();
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.width * scale;
    context.lineJoin = 'round';
    context.lineCap = 'round';

    if (stroke.isEraser) {
        context.globalCompositeOperation = 'destination-out';
    } else {
        context.globalCompositeOperation = 'source-over';
    }

    const firstPoint = worldToViewport(stroke.points[0]);
    context.moveTo(firstPoint.x, firstPoint.y);

    // Quadratic curves for smooth lines
    for (let i = 1; i < stroke.points.length - 1; i++) {
        const p1 = worldToViewport(stroke.points[i]);
        const p2 = worldToViewport(stroke.points[i + 1]);  // ✓ FIXED
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        context.quadraticCurveTo(p1.x, p1.y, midX, midY);
    }

    if (stroke.points.length > 1) {
        const lastPoint = worldToViewport(stroke.points[stroke.points.length - 1]);
        context.lineTo(lastPoint.x, lastPoint.y);
    }

    context.stroke();
    context.globalCompositeOperation = 'source-over';
}


// =======================
// Mouse Movement
// =======================
canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('wheel', onMouseWheel);

function onMouseDown(event) {

    if (event.button === 0) {
        currStrokeId = Math.floor(Date.now() + Math.random());
        leftMouseDown = true;
        rightMouseDown = false;

        mouseX = event.pageX;
        mouseY = event.pageY;

        const worldPos = viewportToWorld({x: mouseX, y: mouseY});
        currStroke = {
            id: currStrokeId,
            userId: myUserId,
            points: [worldPos],
            color: currBrushColor,
            width: currBrushWidth,
            isEraser: currTool === 'erase'
        };

        requestRedraw();
    }

    if (event.button === 2) {
        rightMouseDown = true
        leftMouseDown = false
         mouseX = event.pageX;
    mouseY = event.pageY;

        prevMouseX = event.pageX;
        prevMouseY = event.pageY;

        updateCursor();
    }
}

function onMouseMove(event) {
    mouseX = event.pageX;
    mouseY = event.pageY;

    if (leftMouseDown && currStroke) {
        const worldPos = viewportToWorld({x: mouseX, y: mouseY});
        currStroke.points.push(worldPos);
        
        console.log(currStrokeId)
        socket.send(JSON.stringify({
            type: 'draw',
            id: currStrokeId,
            x: worldPos.x,
            y: worldPos.y,
            color: currBrushColor,
            width: currBrushWidth,
            isEraser: currTool === 'erase'
        }));

        requestRedraw();
    }

    if (rightMouseDown) {
        offsetX += (mouseX - prevMouseX) / scale;
        offsetY += (mouseY - prevMouseY) / scale;
        requestRedraw();
        prevMouseX = mouseX;
        prevMouseY = mouseY;
    }
}

function onMouseUp() {
    if (leftMouseDown && currStroke) {
        drawings.push(currStroke);
        currStroke = null;

        // Only clear redo stack for current user's strokes
        undoneDrawings = undoneDrawings.filter(s => s.userId !== myUserId)
        updateUndoRedoButtons()
    }

    leftMouseDown = false;
    rightMouseDown = false;

    updateCursor()
}

function onMouseWheel(event) {
    const deltaY = event.deltaY;
    const scaleAmount = -deltaY / 500;
    scale = Math.max(0.1, Math.min(10, scale * (1 + scaleAmount)));

    const distX = event.pageX / canvas.clientWidth;
    const distY = event.pageY / canvas.clientHeight;

    const worldSize = visibleWorldSize();
    const unitsZoomedX = worldSize.width * scaleAmount;
    const unitsZoomedY = worldSize.height * scaleAmount;

    offsetX -= unitsZoomedX * distX;
    offsetY -= unitsZoomedY * distY;

    requestRedraw();
}

function updateCursor() {
    if (rightMouseDown) {
        canvas.style.cursor = 'grabbing';
    } else {
        canvas.style.cursor = 'crosshair';
    }
}

// =======================
// TOOLBAR 
// =======================

const colorSwatches = document.querySelectorAll('.swatch');
const colorMenu = document.getElementById('colorMenu');
const colorPicker = document.getElementById('colorPicker');
const colorGrid = document.getElementById('colorGrid');
const brushSize = document.getElementById('brushSize');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');

let activeSwatchForMenu = null;
let activeSwatch = colorSwatches[0];
const clickTimers = new Map();

const colors = [
    '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00',
    '#FF00FF', '#00FFFF', '#800000', '#008000', '#000080', '#808000',
    '#800080', '#008080', '#C0C0C0', '#808080', '#FFA500', '#A52A2A',
    '#FFC0CB', '#FFD700', '#4B0082', '#9370DB', '#90EE90', '#FF6347'
];

document.addEventListener('click', (e) => {
    if (!e.target.closest('.color-picker-container')) {
        closeMenu();
    }
});

colors.forEach(color => {
    const option = document.createElement('div');
    option.className = 'color-option';
    option.style.background = color;
    option.dataset.color = color;
    colorGrid.appendChild(option);
});

colorGrid.addEventListener('click', (e) => {
    if (e.target.classList.contains('color-option')) {
        selectColor(e.target.dataset.color);
        closeMenu();
    }
});

colorPicker.addEventListener('input', (e) => selectColor(e.target.value));


colorMenu.addEventListener('click', (e) => {
    e.stopPropagation();
});

colorSwatches.forEach(swatch => {
    swatch.addEventListener('click', (e) => {
        const color = swatch.dataset.color;
        const size = parseInt(swatch.dataset.size) || 5;
        
        if (clickTimers.has(swatch)) {
            clearTimeout(clickTimers.get(swatch));
            clickTimers.delete(swatch);
            openMenu(swatch);
        } else {
            const timer = setTimeout(() => {
                selectColor(color);
                selectBrushSize(size);
                clickTimers.delete(swatch);
            }, 250);
            clickTimers.set(swatch, timer);
        }
    });
});

function selectColor(color) {
    currBrushColor = color;
    
    if (activeSwatch) {
        activeSwatch.classList.remove('active');
    }
    
    let matchingSwatch = null;
    for (const swatch of colorSwatches) {
        if (swatch.dataset.color.toUpperCase() === color.toUpperCase()) {
            matchingSwatch = swatch;
            break;
        }
    }
    
    if (matchingSwatch) {
        activeSwatch = matchingSwatch;
    } else if (activeSwatchForMenu) {
        const circle = activeSwatchForMenu.querySelector('.swatch-circle');
        if (circle) {
            circle.style.background = color;
        }
        activeSwatchForMenu.dataset.color = color;
        activeSwatch = activeSwatchForMenu;
    }
    
    if (activeSwatch) {
        activeSwatch.classList.add('active');
        updateBrushPreview();   
    }
}

function openMenu(swatch) {
    activeSwatchForMenu = swatch;
    colorMenu.classList.remove('hidden');
    colorPicker.value = currBrushColor;
    const swatchSize = parseInt(swatch.dataset.size) || currBrushWidth;
    selectBrushSize(swatchSize);
}

function closeMenu() {
    colorMenu.classList.add('hidden');
    activeSwatchForMenu = null;
}

brushSize.addEventListener('input', (e) => {
    selectBrushSize(parseInt(e.target.value));
});

function selectBrushSize(size) {
    currBrushWidth = size;
    brushSize.value = currBrushWidth;
    
    if (activeSwatch) {
        activeSwatch.dataset.size = currBrushWidth;
    }
    
    updateBrushPreview();
}

function updateBrushPreview() {
    if (activeSwatch) {
        const circle = activeSwatch.querySelector('.swatch-circle');
        if (circle) {
            const size = Math.min(36, Math.max(8, currBrushWidth * 1.5));
            circle.style.width = size + 'px';
            circle.style.height = size + 'px';
        }
    }
}

undoBtn.addEventListener('click', undo)
redoBtn.addEventListener('click', redo)

function undo() {
    // Find last stroke by current user
    for (let i = drawings.length - 1; i >= 0; i--) {
        if (drawings[i].userId === myUserId) {
            const stroke = drawings.splice(i, 1)[0]
            undoneDrawings.push(stroke)
            socket.send(JSON.stringify({
                type:'undo',
                id: stroke.id,
            }))
            updateUndoRedoButtons()
            requestRedraw()
            return
        }
    }
}

function redo() {
    if (undoneDrawings.length > 0) {
        const stroke = undoneDrawings.pop()
        drawings.push(stroke)

        // Send complete stroke data in one message
        socket.send(JSON.stringify({
            type: 'redo',
            id: stroke.id,
            points: stroke.points,
            color: stroke.color,
            width: stroke.width,
            isEraser: stroke.isEraser,
        }));

        updateUndoRedoButtons()
        requestRedraw()
    }
}
function updateUndoRedoButtons() {
    undoBtn.disabled = !drawings.some(s => s.userId === myUserId)
    redoBtn.disabled = undoneDrawings.length === 0
}

// =======================
// Keybinds 
// =======================

document.addEventListener('keydown', (e) => {
    // Ctrl+Z (Windows/Linux) or Cmd+Z (Mac)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
    }

    // Ctrl+Y (Windows/Linux) or Cmd+Shift+Z (Mac)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
    }
});
// =======================
// ROOMS 
// =======================
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
}

const urlParams = new URLSearchParams(window.location.search);
let roomCode = urlParams.get('room');

if (!roomCode) {
    roomCode = generateRoomCode();
    window.history.replaceState({}, '', `?room=${roomCode}`);
}

let socket = new WebSocket(`ws://localhost:8080/ws?room=${roomCode}`)

socket.onopen = () => {
    console.log("websocket con success")
    // Request userId from server
    socket.send(JSON.stringify({ type: 'getUserId' }))
}

const remoteStrokes = new Map()
socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'userId') {
        myUserId = data.userId
    }

    if (data.type === 'draw') {
        if (!remoteStrokes.has(data.id)) {

            const stroke = {
                id: data.id,
                userId: data.userId,
                points: [],
                color: data.color,
                width: data.width,
                isEraser: data.isEraser
        };
            remoteStrokes.set(data.id, stroke);
            drawings.push(stroke)
    }
        const stroke = remoteStrokes.get(data.id);
        stroke.points.push({x: data.x, y: data.y});

        requestRedraw();
    }

    if (data.type === 'undo') {
        const index = drawings.findIndex(s => s.id === data.id)
        if (index !== -1) {
            drawings.splice(index, 1)
            remoteStrokes.delete(data.id)
        }
        requestRedraw()
    }

    if (data.type === 'redo') {
        const stroke = {
            id: data.id,
            userId: data.userId,
            points: data.points,
            color: data.color,
            width: data.width,
            isEraser: data.isEraser
        };
        remoteStrokes.set(data.id, stroke);
        drawings.push(stroke);
        requestRedraw();
    }

    if (data.type === 'cursor') {
        
    }
};



// =======================
// init 
// =======================
redrawCanvas();
updateCursor();
window.addEventListener("resize", requestRedraw);
