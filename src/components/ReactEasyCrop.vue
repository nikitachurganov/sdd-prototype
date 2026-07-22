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
})

const emit = defineEmits(['update:crop', 'update:zoom', 'update:rotation', 'crop-complete'])
const host = ref(null)
let root

const cropValue = computed(() => props.crop)

function renderCropper() {
  if (!root) return

  root.render(React.createElement(Cropper, {
    image: props.image,
    crop: cropValue.value,
    zoom: props.zoom,
    rotation: props.rotation,
    aspect: props.aspect || undefined,
    showGrid: true,
    restrictPosition: false,
    onCropChange: (crop) => emit('update:crop', crop),
    onZoomChange: (zoom) => emit('update:zoom', zoom),
    onRotationChange: (rotation) => emit('update:rotation', rotation),
    onCropComplete: (_, pixels) => emit('crop-complete', pixels),
  }))
}

onMounted(async () => {
  await nextTick()
  root = createRoot(host.value)
  renderCropper()
})

watch(() => [props.image, props.crop.x, props.crop.y, props.zoom, props.rotation, props.aspect], renderCropper, { deep: true })

onBeforeUnmount(() => root?.unmount())
</script>

<template>
  <div ref="host" class="react-easy-crop-host" aria-label="Область кадрирования изображения" />
</template>

<style>
.react-easy-crop-host {
  position: absolute;
  inset: 0;
}
</style>
