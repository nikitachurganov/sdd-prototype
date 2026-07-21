<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const props = defineProps({
  url: { type: String, required: true },
  source: { type: Object, default: null },
  page: { type: Number, required: true },
  zoom: { type: Number, default: 1 },
})
const emit = defineEmits(['loaded', 'error', 'page-change'])

const host = ref(null)
const pages = ref([])
const canvasByPage = new Map()
let documentProxy = null
let documentUrl = ''
let loadingTask = null
let loadingPromise = null
let renderTasks = []
let renderVersion = 0
let resizeObserver = null
let scrollFrame = 0

function setCanvas(pageNumber, element) {
  if (element) canvasByPage.set(pageNumber, element)
  else canvasByPage.delete(pageNumber)
}

async function loadDocument(sourceUrl, version) {
  if (documentUrl !== sourceUrl) {
    await documentProxy?.destroy()
    loadingTask?.destroy()
    documentProxy = null
    documentUrl = sourceUrl
    loadingTask = null
    loadingPromise = (async () => {
      const data = typeof props.source?.arrayBuffer === 'function'
        ? new Uint8Array(await props.source.arrayBuffer())
        : null

      if (documentUrl !== sourceUrl) return null
      loadingTask = pdfjs.getDocument(data ? { data } : sourceUrl)
      return loadingTask.promise
    })()
  }

  if (!documentProxy) {
    const loadedDocument = await loadingPromise
    if (!loadedDocument || version !== renderVersion || documentUrl !== sourceUrl) return null
    documentProxy = loadedDocument
    pages.value = Array.from({ length: documentProxy.numPages }, (_, index) => index + 1)
    await nextTick()
    emit('loaded', documentProxy.numPages)
  }

  return documentProxy
}

async function renderPages() {
  if (!host.value || !props.url) return
  const version = ++renderVersion
  renderTasks.forEach((task) => task.cancel())
  renderTasks = []

  try {
    const document = await loadDocument(props.url, version)
    if (!document || version !== renderVersion) return

    const width = Math.max((host.value.clientWidth - 16) * props.zoom, 1)
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)

    for (const pageNumber of pages.value) {
      const canvas = canvasByPage.get(pageNumber)
      if (!canvas || version !== renderVersion) return

      const page = await document.getPage(pageNumber)
      const basis = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / basis.width })
      canvas.width = Math.floor(viewport.width * pixelRatio)
      canvas.height = Math.floor(viewport.height * pixelRatio)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`

      const task = page.render({
        canvas,
        viewport,
        transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      })
      renderTasks.push(task)
      await task.promise
    }

    scrollToPage(props.page, 'auto')
  } catch (error) {
    if (error?.name !== 'RenderingCancelledException') emit('error', error)
  }
}

function scrollToPage(pageNumber, behavior = 'smooth') {
  const canvas = canvasByPage.get(pageNumber)
  if (!canvas || !host.value) return
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  host.value.scrollTo({ top: Math.max(0, canvas.offsetTop - 8), behavior: reduceMotion ? 'auto' : behavior })
}

function handleScroll() {
  window.cancelAnimationFrame(scrollFrame)
  scrollFrame = window.requestAnimationFrame(() => {
    const scrollPosition = host.value.scrollTop + 16
    let activePage = 1

    for (const pageNumber of pages.value) {
      const canvas = canvasByPage.get(pageNumber)
      if (canvas && canvas.offsetTop <= scrollPosition) activePage = pageNumber
      else break
    }

    if (activePage !== props.page) emit('page-change', activePage)
  })
}

onMounted(() => {
  resizeObserver = new ResizeObserver(renderPages)
  resizeObserver.observe(host.value)
  renderPages()
})

watch(() => [props.url, props.source], renderPages)
watch(() => props.page, (page) => scrollToPage(page))
watch(() => props.zoom, renderPages)

onBeforeUnmount(async () => {
  resizeObserver?.disconnect()
  window.cancelAnimationFrame(scrollFrame)
  renderTasks.forEach((task) => task.cancel())
  loadingTask?.destroy()
  await documentProxy?.destroy()
})
</script>

<template>
  <div ref="host" class="pdf-preview" aria-label="Страницы PDF-документа" @scroll.passive="handleScroll">
    <canvas v-for="pageNumber in pages" :key="pageNumber" :ref="(element) => setCanvas(pageNumber, element)" />
  </div>
</template>

<style scoped>
.pdf-preview {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 8px;
  scrollbar-width: thin;
  scrollbar-color: #bdbdbd transparent;
}

canvas {
  flex: 0 0 auto;
  display: block;
  background: #ffffff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 16%);
}
</style>
