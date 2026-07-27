<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import React from 'react'
import { createRoot } from 'react-dom/client'
import Cropper from 'react-easy-crop'

const props = defineProps({
  image: { type: String, required: true },
  crop: { type: Object, required: true },
  zoom: { type: Number, required: true },
  rotation: { type: Number, default: 0 },
  aspect: { type: Number, default: null },
  objectFit: { type: String, default: 'contain' },
  fitToCrop: { type: Number, default: 0 },
})

const emit = defineEmits(['update:crop', 'update:zoom', 'update:rotation', 'crop-complete'])
const host = ref(null)
const cropperHost = ref(null)
const interaction = ref(null)
const frameSize = ref(null)
const mediaSize = ref(null)
const cropSize = ref(null)
let root
let frameMeasureRequest = 0
let frameResizeObserver = null

const cropValue = computed(() => props.crop)
const cropFrameStyle = computed(() => {
  if (!frameSize.value?.width || !frameSize.value?.height) return { display: 'none' }
  return {
    width: `${frameSize.value.width * props.zoom}px`,
    height: `${frameSize.value.height * props.zoom}px`,
    transform: `translate(-50%, -50%) translate(${props.crop.x}px, ${props.crop.y}px) rotate(${props.rotation}deg)`,
  }
})

const resizeHandles = [
  ['n', 'верхнюю грань'], ['ne', 'правый верхний угол'], ['e', 'правую грань'], ['se', 'правый нижний угол'],
  ['s', 'нижнюю грань'], ['sw', 'левый нижний угол'], ['w', 'левую грань'], ['nw', 'левый верхний угол'],
]

const rotateHandles = [
  ['nw', 'левого верхнего угла'], ['ne', 'правого верхнего угла'],
  ['se', 'правого нижнего угла'], ['sw', 'левого нижнего угла'],
]

function renderCropper() {
  if (!root) return

  root.render(React.createElement(Cropper, {
    image: props.image,
    crop: cropValue.value,
    zoom: props.zoom,
    rotation: props.rotation,
    aspect: props.aspect || undefined,
    objectFit: props.objectFit,
    minZoom: 0.25,
    maxZoom: 2.5,
    showGrid: true,
    restrictPosition: false,
    // Zoom is handled by the Vue container so a mouse wheel is processed once
    // and stays in sync with the visible percentage control.
    zoomWithScroll: false,
    onCropChange: (crop) => emit('update:crop', crop),
    onZoomChange: (zoom) => emit('update:zoom', zoom),
    onRotationChange: (rotation) => emit('update:rotation', rotation),
    onMediaLoaded: (size) => {
      mediaSize.value = size
      scheduleFrameMeasure()
    },
    setMediaSize: (size) => {
      mediaSize.value = size
    },
    onCropSizeChange: (size) => {
      cropSize.value = size
    },
    onCropComplete: (_, pixels) => emit('crop-complete', pixels),
  }))
  scheduleFrameMeasure()
}

function fitMediaToCrop() {
  const media = mediaSize.value
  const cropArea = cropSize.value
  if (!media?.width || !media?.height || !cropArea?.width || !cropArea?.height) return

  const radians = props.rotation * Math.PI / 180
  const rotatedWidth = Math.abs(media.width * Math.cos(radians)) + Math.abs(media.height * Math.sin(radians))
  const rotatedHeight = Math.abs(media.width * Math.sin(radians)) + Math.abs(media.height * Math.cos(radians))
  const zoom = Math.min(cropArea.width / rotatedWidth, cropArea.height / rotatedHeight)

  emit('update:crop', { x: 0, y: 0 })
  emit('update:zoom', Math.min(2.5, Math.max(0.25, zoom)))
}

function scheduleFrameMeasure() {
  if (frameMeasureRequest) window.cancelAnimationFrame(frameMeasureRequest)
  frameMeasureRequest = window.requestAnimationFrame(() => {
    frameMeasureRequest = 0
    const image = cropperHost.value?.querySelector('.reactEasyCrop_Image')
    if (!image?.offsetWidth || !image?.offsetHeight) return
    frameSize.value = { width: image.offsetWidth, height: image.offsetHeight }
  })
}

function getFrameCenter() {
  const bounds = host.value?.getBoundingClientRect()
  if (!bounds) return null
  return {
    x: bounds.left + bounds.width / 2 + props.crop.x,
    y: bounds.top + bounds.height / 2 + props.crop.y,
  }
}

function startResize(event, direction) {
  const center = getFrameCenter()
  if (!center) return
  event.preventDefault()
  event.stopPropagation()
  const horizontal = direction.includes('e') || direction.includes('w')
  const vertical = direction.includes('n') || direction.includes('s')
  const startDistance = horizontal && vertical
    ? Math.hypot(event.clientX - center.x, event.clientY - center.y)
    : horizontal
      ? Math.abs(event.clientX - center.x)
      : Math.abs(event.clientY - center.y)
  interaction.value = {
    type: 'zoom',
    pointerId: event.pointerId,
    horizontal,
    vertical,
    center,
    startDistance: Math.max(1, startDistance),
    startZoom: props.zoom,
  }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function startRotation(event) {
  const center = getFrameCenter()
  if (!center) return
  event.preventDefault()
  event.stopPropagation()
  interaction.value = {
    type: 'rotate',
    pointerId: event.pointerId,
    centerX: center.x,
    centerY: center.y,
    startAngle: Math.atan2(event.clientY - center.y, event.clientX - center.x) * 180 / Math.PI,
    startRotation: props.rotation,
  }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function moveInteraction(event) {
  const current = interaction.value
  if (!current || current.pointerId !== event.pointerId) return
  event.preventDefault()

  if (current.type === 'rotate') {
    const angle = Math.atan2(event.clientY - current.centerY, event.clientX - current.centerX) * 180 / Math.PI
    emit('update:rotation', (current.startRotation + angle - current.startAngle + 360) % 360)
    return
  }

  const distance = current.horizontal && current.vertical
    ? Math.hypot(event.clientX - current.center.x, event.clientY - current.center.y)
    : current.horizontal
      ? Math.abs(event.clientX - current.center.x)
      : Math.abs(event.clientY - current.center.y)
  emit('update:zoom', Math.min(2.5, Math.max(0.25, current.startZoom * distance / current.startDistance)))
}

function endInteraction(event) {
  if (interaction.value?.pointerId !== event.pointerId) return
  interaction.value = null
  event.currentTarget.releasePointerCapture?.(event.pointerId)
}

onMounted(async () => {
  await nextTick()
  root = createRoot(cropperHost.value)
  renderCropper()
  frameResizeObserver = new ResizeObserver(scheduleFrameMeasure)
  frameResizeObserver.observe(host.value)
})

watch(() => [
  props.image, props.crop.x, props.crop.y, props.zoom, props.rotation, props.aspect,
  props.objectFit,
], renderCropper, { deep: true })

watch(() => props.fitToCrop, () => {
  // The first frame lets React apply the new object-fit; the second one reads
  // the corresponding rendered media size.
  nextTick(() => window.requestAnimationFrame(() => window.requestAnimationFrame(fitMediaToCrop)))
})

onBeforeUnmount(() => {
  root?.unmount()
  frameResizeObserver?.disconnect()
  if (frameMeasureRequest) window.cancelAnimationFrame(frameMeasureRequest)
})
</script>

<template>
  <div ref="host" class="react-easy-crop-host" aria-label="Область кадрирования изображения">
    <div ref="cropperHost" class="react-easy-crop-host__canvas" />
    <div class="crop-transform-frame" :style="cropFrameStyle" aria-hidden="true">
      <span class="crop-transform-frame__outline" />
      <span
        v-for="[direction, label] in resizeHandles"
        :key="direction"
        :class="['crop-transform-frame__resize-handle', `crop-transform-frame__resize-handle--${direction}`]"
        :title="`Потяните за ${label}, чтобы изменить масштаб изображения`"
        @pointerdown="startResize($event, direction)"
        @pointermove="moveInteraction"
        @pointerup="endInteraction"
        @pointercancel="endInteraction"
      />
      <span
        v-for="[corner, label] in rotateHandles"
        :key="corner"
        :class="['crop-transform-frame__rotate-handle', `crop-transform-frame__rotate-handle--${corner}`]"
        :title="`Потяните рядом с ${label}, чтобы повернуть изображение`"
        @pointerdown="startRotation"
        @pointermove="moveInteraction"
        @pointerup="endInteraction"
        @pointercancel="endInteraction"
      />
    </div>
  </div>
</template>

<style>
.react-easy-crop-host {
  position: absolute;
  inset: 0;
}

.react-easy-crop-host__canvas {
  position: absolute;
  inset: 0;
}

.crop-transform-frame {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 2;
  box-sizing: border-box;
  transform-origin: center;
  pointer-events: none;
}

.crop-transform-frame__outline {
  position: absolute;
  inset: 0;
  border: 1px solid rgb(255 255 255 / 90%);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 30%);
}

.crop-transform-frame__resize-handle,
.crop-transform-frame__rotate-handle {
  position: absolute;
  z-index: 1;
  display: block;
  pointer-events: auto;
}

.crop-transform-frame__resize-handle {
  width: 18px;
  height: 18px;
  border: 2px solid #ffffff;
  border-radius: 3px;
  box-sizing: border-box;
  background: #007de3;
  box-shadow: 0 1px 2px rgb(0 0 0 / 35%);
}

.crop-transform-frame__resize-handle--n,
.crop-transform-frame__resize-handle--s {
  left: 50%;
  margin-left: -9px;
  cursor: ns-resize;
}

.crop-transform-frame__resize-handle--e,
.crop-transform-frame__resize-handle--w {
  top: 50%;
  margin-top: -9px;
  cursor: ew-resize;
}

.crop-transform-frame__resize-handle--n { top: -9px; }
.crop-transform-frame__resize-handle--ne { top: -9px; right: -9px; cursor: nesw-resize; }
.crop-transform-frame__resize-handle--e { right: -9px; }
.crop-transform-frame__resize-handle--se { right: -9px; bottom: -9px; cursor: nwse-resize; }
.crop-transform-frame__resize-handle--s { bottom: -9px; }
.crop-transform-frame__resize-handle--sw { bottom: -9px; left: -9px; cursor: nesw-resize; }
.crop-transform-frame__resize-handle--w { left: -9px; }
.crop-transform-frame__resize-handle--nw { top: -9px; left: -9px; cursor: nwse-resize; }

.crop-transform-frame__rotate-handle {
  width: 28px;
  height: 28px;
  border: 1px solid rgb(255 255 255 / 90%);
  border-radius: 50%;
  background: rgb(0 125 227 / 90%);
  box-shadow: 0 1px 2px rgb(0 0 0 / 35%);
  cursor: grab;
  opacity: 0;
  transition: opacity 160ms ease-out;
}

.crop-transform-frame:hover .crop-transform-frame__rotate-handle,
.crop-transform-frame__rotate-handle:hover {
  opacity: 1;
}

.crop-transform-frame__rotate-handle::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 10px;
  height: 10px;
  border: 1.5px solid #ffffff;
  border-left-color: transparent;
  border-radius: 50%;
  content: '';
  transform: translate(-50%, -50%);
}

.crop-transform-frame__rotate-handle--nw { top: -36px; left: -36px; }
.crop-transform-frame__rotate-handle--ne { top: -36px; right: -36px; }
.crop-transform-frame__rotate-handle--se { right: -36px; bottom: -36px; }
.crop-transform-frame__rotate-handle--sw { bottom: -36px; left: -36px; }

.crop-transform-frame__rotate-handle:active { cursor: grabbing; }

@media (max-width: 600px) {
  .crop-transform-frame__resize-handle,
  .crop-transform-frame__rotate-handle {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .crop-transform-frame__rotate-handle {
    transition: none;
  }
}
</style>
