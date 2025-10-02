const toolbar = document.getElementById('toolbar');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');

document.oncontextmenu = () => false;

const drawings = []
const undoneDrawings = []
let currStroke = null
let redrawQueued = false

let mouseX, mouseY, prevMouseX, prevMouseY;
let leftMouseDown = 0, rightMouseDown = 0;
let offsetX = 0, offsetY = 0;
let scale = 1;

let currTool = 'draw'
let lineColor = '#000000'
let lineWidth = 5; 

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
function updateCursor() {
    if (rightMouseDown) {
        canvas.style.cursor = 'grabbing';
    } else {
        canvas.style.cursor = 'crosshair';
    }
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
    if (stroke.points.length < 2) return;

    if (stroke.points.length === 1) {
        const point = worldToViewport(stroke.points[0]);
        context.beginPath();
        context.arc(point.x, point.y, stroke.width * scale / 2, 0, Math.PI * 2);
        context.fillStyle = stroke.color;
        context.fill();
        return;
    }

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

redrawCanvas();
updateCursor();
window.addEventListener("resize", requestRedraw);

// =======================
// Mouse Movement
// =======================
canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseup', onMouseUp);
;
function onMouseDown(event) {
   

    if (event.button === 0) {
        leftMouseDown = true;
        rightMouseDown = false;

         mouseX = event.pageX;
        mouseY = event.pageY;

        const worldPos = viewportToWorld({x: mouseX, y: mouseY});
        currStroke = {
            points: [worldPos],
            color: lineColor,
            width: lineWidth,
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

// =======================
// TOOLBAR 
// =======================

const colorSwatches = document.querySelectorAll('.swatch');
        const colorMenu = document.getElementById('colorMenu');
        const colorPicker = document.getElementById('colorPicker');
        const colorGrid = document.getElementById('colorGrid');

        let activeSwatchForMenu = null;
        let activeSwatch = colorSwatches[0];
        const clickTimers = new Map();

        const colors = [
            '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00',
            '#FF00FF', '#00FFFF', '#800000', '#008000', '#000080', '#808000',
            '#800080', '#008080', '#C0C0C0', '#808080', '#FFA500', '#A52A2A',
            '#FFC0CB', '#FFD700', '#4B0082', '#9370DB', '#90EE90', '#FF6347'
        ];

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

        colorSwatches.forEach(swatch => {
            swatch.addEventListener('click', (e) => {
                const color = e.target.dataset.color;
                
                if (clickTimers.has(swatch)) {
                    clearTimeout(clickTimers.get(swatch));
                    clickTimers.delete(swatch);
                    openMenu(swatch);
                } else {
                    const timer = setTimeout(() => {
                        selectColor(color);
                        clickTimers.delete(swatch);
                    }, 250);
                    clickTimers.set(swatch, timer);
                }
            });
        });

        colorPicker.addEventListener('input', (e) => selectColor(e.target.value));

        function selectColor(color) {
            lineColor = color;
            
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
                activeSwatchForMenu.style.background = color;
                activeSwatchForMenu.dataset.color = color;
                activeSwatch = activeSwatchForMenu;
            }
            
            if (activeSwatch) {
                activeSwatch.classList.add('active');
            }
        }

        function openMenu(swatch) {
            activeSwatchForMenu = swatch;
            colorMenu.classList.remove('hidden');
            colorPicker.value = lineColor;
        }

        function closeMenu() {
            colorMenu.classList.add('hidden');
            activeSwatchForMenu = null;
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.color-picker-container')) {
                closeMenu();
            }
        });

        colorMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
