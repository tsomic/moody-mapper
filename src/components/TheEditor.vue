<template>
  <div class="text-white">
    <div class="text-base bg-[#fff1] rounded mb-2.5 w-full text-center">
      {{ fileName }}
    </div>
    <div class="relative">
      <canvas class="w-full" ref="pixels" />
      <canvas class="w-full absolute top-0 opacity-50" ref="backgroundLayer" />
      <canvas
        class="w-full absolute top-0"
        ref="grid"
        @contextmenu.prevent
        @mousedown="onPixelClick"
        @mouseup="onPointerUp"
        @touchend="onPointerUp"
        @mouseout="onMouseOut"
        @mousemove="onPointerMove($event.clientX, $event.clientY)"
        @touchstart.prevent="onPixelClick($event.touches[0])"
        @touchmove="
          onPointerMove($event.touches[0].clientX, $event.touches[0].clientY)
        "
      />
      <canvas class="hidden" ref="imageData" />
    </div>
    <div class="h-8">{{ coordinatesText }}</div>
    <div class="flex justify-between">
      <div class="flex gap-2.5">
        <BaseButton
          tooltip="W̲ipe canvas"
          icon="fa-snowplow"
          @click="wipePixelCanvas"
        />
        <BaseButton
          tooltip="M̲irror from left to right"
          icon="fa-arrows-left-right-to-line"
          @click="mirror"
        />
        <BaseButton tooltip="P̲review" icon="fa-eye" @click="preview" />
      </div>
      <div class="flex gap-2.5">
        <BaseButton
          tooltip="Undo"
          icon="fa-rotate-left"
          @click="historyPrevious"
        />
        <BaseButton
          tooltip="Redo"
          icon="fa-rotate-right"
          @click="historyNext"
        />
      </div>
      <div class="flex gap-2.5 items-center">
        <div class="w-4">{{ layerText }}</div>
        <BaseButton @click="layer" tooltip="Switch L̲ayer" icon="fa-clone" />
        <BaseButton
          tooltip="Upload (Control+U)"
          icon="fa-file-image"
          @click="uploadInput?.click()"
        />
        <input
          class="hidden"
          ref="uploadInput"
          type="file"
          @change="upload"
          accept="image/png, image/jpeg"
        />
        <BaseButton @click="save" tooltip="Save (Control+S)" icon="fa-save" />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useEditorStore } from "@/stores/editor";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import BaseButton from "./BaseButton.vue";
import { useFacesStore } from "@/stores/faces";

const { face } = storeToRefs(useEditorStore());

type PixelData = Array<Array<number>>;

const PIXEL_SIZE = 25;
const IMAGE_WIDTH = 32;
const IMAGE_HEIGHT = 16;

const CANVAS_WIDTH = IMAGE_WIDTH * PIXEL_SIZE;
const CANVAS_HEIGHT = IMAGE_HEIGHT * PIXEL_SIZE;

const dataHistory = ref<Array<PixelData>>([]);
const currentHistoryIndex = ref(0);
const currentSaveIndex = ref(0);
const isButtonDown = ref(false);
const holdValue = ref(1);
const holdData = ref<PixelData>([]);
const previousPointerPosition = ref({ x: 0, y: 0 });
const fileName = ref("");
const coordinates = ref<{ x?: number; y?: number }>({});
const backgroundLayerData = ref<PixelData>([]);

const pixels = ref<HTMLCanvasElement | null>(null);
const backgroundLayer = ref<HTMLCanvasElement | null>(null);
const grid = ref<HTMLCanvasElement | null>(null);
const imageData = ref<HTMLCanvasElement | null>(null);
const uploadInput = ref<HTMLInputElement | null>(null);

const pixelsCtx = ref<CanvasRenderingContext2D | null>();
const backgroundLayerCtx = ref<CanvasRenderingContext2D | null>();
const gridCtx = ref<CanvasRenderingContext2D | null>();
const imageDataCtx = ref<CanvasRenderingContext2D | null>();

const faces = computed(
  () => useFacesStore().faces.find((f) => f.name === face.value)?.images || []
);
const coordinatesText = computed(() =>
  coordinates.value.x !== undefined
    ? `${coordinates.value.x}, ${coordinates.value.y}`
    : ""
);
const layerText = computed(() => `${currentLayer.value + 1}/2 `);
const currentLayer = ref(0);
const previewIntervalId = ref();

const hasUnsavedChanges = computed(() => {
  return currentHistoryIndex.value !== currentSaveIndex.value;
});

const emit = defineEmits(["unsavedChange"]);

watch(hasUnsavedChanges, (hasUnsavedChanges) => {
  emit("unsavedChange", hasUnsavedChanges);
});

onMounted(async () => {
  if (
    !pixels.value ||
    !grid.value ||
    !imageData.value ||
    !backgroundLayer.value
  ) {
    return;
  }

  pixelsCtx.value = pixels.value.getContext("2d");
  backgroundLayerCtx.value = backgroundLayer.value.getContext("2d");
  gridCtx.value = grid.value.getContext("2d");
  imageDataCtx.value = imageData.value.getContext("2d", {
    willReadFrequently: true,
  });

  pixels.value.width =
    backgroundLayer.value.width =
    grid.value.width =
      CANVAS_WIDTH;

  pixels.value.height =
    backgroundLayer.value.height =
    grid.value.height =
      CANVAS_HEIGHT;

  imageData.value.width = IMAGE_WIDTH;
  imageData.value.height = IMAGE_HEIGHT;

  fileName.value = face.value;

  drawGrid();
  holdData.value = getEmptyData();
  await loadImageBase64(faces.value[currentLayer.value]);

  if (!backgroundLayerCtx.value) return;
  backgroundLayerCtx.value.imageSmoothingEnabled = false;
  await loadBackgroundLayer();
});

const loadBackgroundLayer = () => {
  if (!backgroundLayerCtx.value) return;

  const nextLayerIndex = (currentLayer.value + 1) % faces.value.length;
  const img = new Image();
  img.src = faces.value[nextLayerIndex];

  backgroundLayerData.value = generateDataFromImg(img) || getEmptyData();

  backgroundLayerCtx.value.clearRect(
    0,
    0,
    backgroundLayerCtx.value.canvas.width,
    backgroundLayerCtx.value.canvas.height
  );

  fillCanvasFromData(
    backgroundLayerData.value,
    backgroundLayerCtx.value,
    undefined,
    true
  );
};

const loadImageFile = async (file: File) => {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();

  loadImage(img);
};

const loadImageBase64 = (base64: string) => {
  const img = new Image();

  img.onload = () => {
    loadImage(img);
  };

  img.src = base64;
};

const loadImage = (img: HTMLImageElement) => {
  const data = generateDataFromImg(img);

  if (data) {
    addHistory(data);
    fillCanvasFromData(data);
  }
};

// #region history
const currentData = computed(
  () => dataHistory.value[currentHistoryIndex.value]
);

const addHistory = (data: PixelData) => {
  dataHistory.value = dataHistory.value.slice(0, currentHistoryIndex.value + 1);
  currentHistoryIndex.value = dataHistory.value.push(data) - 1;
};

const historyPrevious = () => {
  if (currentHistoryIndex.value > 0) {
    currentHistoryIndex.value--;
    fillCanvasFromData();
  }
};

const historyNext = () => {
  if (currentHistoryIndex.value < dataHistory.value.length - 1) {
    currentHistoryIndex.value++;
    fillCanvasFromData();
  }
};

const wipeHistory = () => {
  dataHistory.value = [];
  currentHistoryIndex.value = 0;
};
// #endregion

const onMouseOut = () => {
  coordinates.value = {};
  if (isButtonDown.value) onPointerUp();
};

const drawGrid = () => {
  if (!gridCtx.value) return;

  gridCtx.value.beginPath();
  gridCtx.value.strokeStyle = "#eee";

  for (let i = 0; i < IMAGE_WIDTH; i++) {
    for (let j = 0; j < IMAGE_HEIGHT; j++) {
      gridCtx.value.rect(
        i * PIXEL_SIZE,
        j * PIXEL_SIZE,
        PIXEL_SIZE,
        PIXEL_SIZE
      );
    }
  }

  gridCtx.value.stroke();

  gridCtx.value.beginPath();
  gridCtx.value.strokeStyle = "#bbb";

  const halfWidth = CANVAS_WIDTH / 2;
  gridCtx.value.moveTo(halfWidth, 0);
  gridCtx.value.lineTo(halfWidth, gridCtx.value.canvas.height);

  const halfHeight = CANVAS_HEIGHT / 2;
  gridCtx.value.moveTo(0, halfHeight);
  gridCtx.value.lineTo(gridCtx.value.canvas.width, halfHeight);

  gridCtx.value.stroke();
};

const getEmptyData = () =>
  Array.from({ length: IMAGE_WIDTH }, () =>
    Array.from({ length: IMAGE_HEIGHT }, () => 0)
  );

const wipePixelCanvas = () => {
  if (!pixelsCtx.value) return;

  const data = getEmptyData();

  wipeCanvas(pixelsCtx.value, CANVAS_WIDTH, CANVAS_HEIGHT);
  addHistory(data);

  holdData.value = JSON.parse(JSON.stringify(currentData.value));
};

const mirror = () => {
  const data = JSON.parse(JSON.stringify(currentData.value));

  for (let i = 0; i < data.length / 2; i++) {
    data[data.length - i - 1] = [...data[i]];
  }

  addHistory(data);
  fillCanvasFromData(data);
};

const preview = () => {
  if (!confirmUnsaved()) return;

  if (!grid.value || !pixels.value || !backgroundLayer.value) return;

  grid.value.classList.toggle("hidden");
  pixels.value.classList.toggle("invert");
  backgroundLayer.value.classList.toggle("hidden");

  previewIntervalId.value = previewIntervalId.value
    ? clearInterval(previewIntervalId.value)
    : setInterval(layer, 1000);
};

const save = () => {
  if (!imageData.value || !faces.value) return;
  fillCanvasFromData(undefined, imageDataCtx.value, 1);
  faces.value[currentLayer.value] = imageData.value.toDataURL();
  currentSaveIndex.value = currentHistoryIndex.value;
};

const upload = () => {
  if (!uploadInput.value) return;
  if (uploadInput.value.files?.length === 1) {
    const file = uploadInput.value.files[0];
    loadImageFile(file);
  }
  uploadInput.value.value = "";
};

const confirmUnsaved = () => {
  if (
    hasUnsavedChanges.value &&
    !confirm("You have unsaved changes that will be lost. Proceed anyways?")
  ) {
    return false;
  }

  wipeHistory();
  currentSaveIndex.value = 0;
  return true;
};

const layer = async () => {
  if (!confirmUnsaved()) return;

  currentLayer.value = (currentLayer.value + 1) % faces.value.length;
  loadImageBase64(faces.value[currentLayer.value]);

  await loadBackgroundLayer();
};

const generateDataFromImg = (img: HTMLImageElement) => {
  if (!imageDataCtx.value) return;

  imageDataCtx.value.drawImage(img, 0, 0);

  const data = getEmptyData();

  data.forEach((column, x) => {
    column.forEach((_, y) => {
      const redData = imageDataCtx.value?.getImageData(x, y, 1, 1).data[0];
      data[x][y] = Number(redData) < 255 ? 1 : 0;
    });
  });
  wipeCanvas(imageDataCtx.value, IMAGE_WIDTH, IMAGE_HEIGHT);

  return data;
};

const wipeCanvas = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number
) => {
  context.fillStyle = "white";
  context.rect(0, 0, width, height);
  context.fill();
};

const fillCanvasFromData = (
  data = currentData.value,
  context = pixelsCtx.value,
  pixelSize = PIXEL_SIZE,
  isBackgroundLayer = false
) => {
  data.forEach((column, x) => {
    column.forEach((_, y) => {
      fillPixel(x, y, data[x][y], false, context, pixelSize, isBackgroundLayer);
    });
  });
};

const fillPixel = (
  x: number,
  y: number,
  value: number,
  writeToHistory = false,
  context = pixelsCtx.value,
  pixelSize = PIXEL_SIZE,
  isBackgroundLayer = false
) => {
  if (!context) return;

  if (writeToHistory) {
    const data = JSON.parse(JSON.stringify(currentData.value));
    data[x][y] = value;
    addHistory(data);
  } else {
    holdData.value[x][y] = value;
  }

  if (value) {
    context.fillStyle = isBackgroundLayer ? "rgba(0, 0, 0, 0.5)" : "black";
  } else {
    context.fillStyle = isBackgroundLayer ? "rgba(0, 0, 0, 0)" : "white";
  }

  context.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
};

const onPixelClick = (event: MouseEvent | Touch) => {
  const rect = pixels.value?.getBoundingClientRect();
  if (!rect) return;

  const x = getPixelValueForPosition(event.clientX - rect.left);
  const y = getPixelValueForPosition(event.clientY - rect.top);

  previousPointerPosition.value = { x, y };

  const pixelData = Math.abs(currentData.value[x][y] - 1);
  fillPixel(x, y, pixelData, true);
  holdValue.value = pixelData;

  isButtonDown.value = true;
  holdData.value = JSON.parse(JSON.stringify(currentData.value));
};

const getPixelValueForPosition = (x: number) => {
  return (
    Math.ceil(
      x / PIXEL_SIZE / ((pixels.value?.offsetWidth || NaN) / CANVAS_WIDTH)
    ) - 1
  );
};

//Bresenham's line algorithm
const drawLine = (x0: number, y0: number, x1: number, y1: number) => {
  const deltaX = Math.abs(x1 - x0);
  const deltaY = Math.abs(y1 - y0);
  const slopeX = x0 < x1 ? 1 : -1;
  const slopeY = y0 < y1 ? 1 : -1;
  let err = deltaX - deltaY;

  while (x0 !== x1 || y0 !== y1) {
    fillPixel(x0, y0, holdValue.value, false);

    const err2 = err * 2;
    if (err2 > -deltaY) {
      err -= deltaY;
      x0 += slopeX;
    }
    if (err2 < deltaX) {
      err += deltaX;
      y0 += slopeY;
    }
  }
};

const onPointerMove = (xPos: number, yPos: number) => {
  const rect = pixels.value?.getBoundingClientRect();
  if (!rect) return;

  const x = getPixelValueForPosition(xPos - rect.left);
  const y = getPixelValueForPosition(yPos - rect.top);
  if (x >= IMAGE_WIDTH || y >= IMAGE_HEIGHT || x < 0 || y < 0) return;

  coordinates.value = { x, y };
  if (isButtonDown.value && currentData.value[x][y] !== holdValue.value) {
    drawLine(
      x,
      y,
      previousPointerPosition.value.x,
      previousPointerPosition.value.y
    );
    previousPointerPosition.value = { x, y };
  }
};

const onPointerUp = () => {
  isButtonDown.value = false;
  if (JSON.stringify(holdData) !== JSON.stringify(currentData.value)) {
    currentHistoryIndex.value = Math.max(0, currentHistoryIndex.value - 1);
    addHistory(JSON.parse(JSON.stringify(holdData.value)));
  }
};

const specialShortcutMap = {
  z: (e: KeyboardEvent) => {
    e.shiftKey ? historyNext() : historyPrevious();
  },
  y: historyNext,
  s: save,
  u: () => uploadInput.value?.click(),
};

const shortcutMap = {
  p: preview,
  m: mirror,
  l: layer,
  w: wipePixelCanvas,
};

const onKeyDown = (e: KeyboardEvent) => {
  const funct =
    e.metaKey || e.ctrlKey
      ? specialShortcutMap[e.key as keyof typeof specialShortcutMap]
      : shortcutMap[e.key as keyof typeof shortcutMap];

  if (!funct) return;

  funct(e);
  e.preventDefault();
  e.stopPropagation();
};

document.addEventListener("keydown", onKeyDown);

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeyDown);
});
</script>
