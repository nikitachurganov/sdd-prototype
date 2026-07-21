<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'

const ReactEasyCrop = defineAsyncComponent(() => import('./components/ReactEasyCrop.vue'))
const PdfPreview = defineAsyncComponent(() => import('./components/PdfPreview.vue'))

const MB = 1024 * 1024
const MAX_FILE_SIZE = 20 * MB
const allowedExtensions = ['pdf', 'jpg', 'jpeg', 'png']
const currentPath = window.location.pathname.replace(/\/+$/, '') || '/'
const statusDisplayMode = currentPath === '/notification' ? 'notification' : 'popover'

let nextId = 20
let tableDragDepth = 0
const timers = new Map()
let mobileListResizeObserver = null
let mobileListScrollFrame = 0

const fileInput = ref(null)
const errorSummary = ref(null)
const dragActive = ref(false)
const previewEnabled = ref(true)
const previewIndex = ref(0)
const previewPage = ref(1)
const previewZoom = ref(1)
const previewPan = ref({ x: 0, y: 0 })
const previewPointer = ref(null)
const cropMode = ref(false)
const crop = ref({ x: 0, y: 0 })
const cropZoom = ref(1)
const cropPixels = ref(null)
const cropFormat = ref('original')
const cropImageRatio = ref(1)
const cropDialog = ref(null)
const pdfPageCounts = ref({})
const previewError = ref('')
const selectedIds = ref([])
const statusMessage = ref('')
const draftSaved = ref(false)
const packageSent = ref(false)
const mobileMenuOpen = ref(false)
const mobileActionsMenuOpen = ref(false)
const mobileActionsSheet = ref(null)
const mobilePreviewOpen = ref(false)
const mobilePreviewDialog = ref(null)
const mobileFileListItems = ref(null)
const mobileListScroll = reactive({
  visible: false,
  thumbHeight: 0,
  thumbOffset: 0,
})

const uploadedFiles = ref([])

const uploadQueue = ref([])

const failedFiles = ref([])

function toFailedUploadActivity(file) {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    type: file.type,
    pages: file.pages,
    progress: 100,
    status: 'error',
    reason: file.reason,
    source: file.source,
  }
}

const uploadActivities = ref(
  statusDisplayMode === 'popover' ? failedFiles.value.map(toFailedUploadActivity) : [],
)
const uploadPanelExpanded = ref(true)
const uploadPanelDismissed = ref(false)
const errorAlertDismissed = ref(false)
const errorAlertExpanded = ref(false)
const pendingDeletionIds = ref([])
const deleteDialog = ref(null)

const failedCount = computed(() => failedFiles.value.length)
const uploadedCount = computed(() => uploadedFiles.value.length)
const selectedCount = computed(() => selectedIds.value.length)
const hasPartialSelection = computed(() => selectedCount.value > 0 && selectedCount.value < uploadedFiles.value.length)
const isUploading = computed(() => uploadQueue.value.length > 0)
const hasBlockingIssues = computed(() => isUploading.value || failedCount.value > 0)
const canSend = computed(() => uploadedCount.value > 0 && !hasBlockingIssues.value)
const uploadPanelVisible = computed(() => uploadActivities.value.length > 0 && !uploadPanelDismissed.value)
const uploadingActivityCount = computed(() => uploadActivities.value.filter((file) => file.status === 'uploading').length)
const failedActivityCount = computed(() => uploadActivities.value.filter((file) => file.status === 'error').length)
const successActivityCount = computed(() => uploadActivities.value.filter((file) => file.status === 'success').length)
const uploadPopoverTitle = computed(() => {
  const count = uploadActivities.value.length
  return (count === 1 ? 'Добавляется ' : 'Добавляются ') + count + ' ' + fileWord(count)
})
const uploadPopoverDescription = computed(() => {
  if (uploadingActivityCount.value) return ''
  if (!failedActivityCount.value) return 'Все файлы успешно добавлены'

  const count = failedActivityCount.value
  const ending = fileWord(count) === 'файл' ? 'не был добавлен.' : 'не были добавлены.'
  const pronoun = count === 1 ? 'его' : 'их'
  return count + ' ' + fileWord(count) + ' ' + ending
    + '\nПопробуйте добавить ' + pronoun + ' еще раз.'
})
const uploadPopoverActivities = computed(() => uploadActivities.value)
const filesPendingDeletion = computed(() => {
  const pending = new Set(pendingDeletionIds.value)
  return uploadedFiles.value.filter((file) => pending.has(file.id))
})

const activityOverallProgress = computed(() => {
  if (!uploadActivities.value.length) return 0
  const total = uploadActivities.value.reduce((sum, file) => sum + (file.status === 'uploading' ? file.progress : 100), 0)
  return Math.round(total / uploadActivities.value.length)
})

const uploadPanelSummary = computed(() => {
  if (uploadingActivityCount.value) {
    const errorText = failedActivityCount.value ? ' · С ошибкой: ' + failedActivityCount.value : ''
    return 'Файлы обрабатываются · ' + activityOverallProgress.value + '%' + errorText
  }
  if (failedActivityCount.value && successActivityCount.value) {
    return 'Обработка завершена · Добавлено: ' + successActivityCount.value + ' · С ошибкой: ' + failedActivityCount.value
  }
  if (failedActivityCount.value) return 'Обработка завершена · Не добавлено: ' + failedActivityCount.value
  return 'Все файлы обработаны и добавлены в пакет'
})

const allSelected = computed({
  get: () => uploadedFiles.value.length > 0 && selectedIds.value.length === uploadedFiles.value.length,
  set: (checked) => {
    selectedIds.value = checked ? uploadedFiles.value.map((file) => file.id) : []
  },
})

const selectedIdSet = computed(() => new Set(selectedIds.value))
const canMoveSelectionUp = computed(() => uploadedFiles.value.some((file, index, files) => (
  index > 0
  && selectedIdSet.value.has(file.id)
  && !selectedIdSet.value.has(files[index - 1].id)
)))
const canMoveSelectionDown = computed(() => uploadedFiles.value.some((file, index, files) => (
  index < files.length - 1
  && selectedIdSet.value.has(file.id)
  && !selectedIdSet.value.has(files[index + 1].id)
)))

const currentPreviewIndex = computed(() => {
  if (!uploadedFiles.value.length) return -1
  return Math.min(Math.max(previewIndex.value, 0), uploadedFiles.value.length - 1)
})
const currentPreviewFile = computed(() => uploadedFiles.value[currentPreviewIndex.value] || null)
const currentPreviewIsImage = computed(() => currentPreviewFile.value?.type?.startsWith('image/'))
const currentPreviewPageCount = computed(() => {
  const renderedPages = pdfPageCounts.value[currentPreviewFile.value?.id]
  if (renderedPages) return renderedPages
  const pages = Number(currentPreviewFile.value?.pages)
  return Number.isFinite(pages) && pages > 0 ? pages : 1
})
const previewZoomPercent = computed(() => Math.round(previewZoom.value * 100))
const cropAspect = computed(() => {
  if (cropFormat.value === 'a4-portrait') return 1 / Math.sqrt(2)
  if (cropFormat.value === 'a4-landscape') return Math.sqrt(2)
  if (cropFormat.value === 'original') return cropImageRatio.value
  return null
})
const cropFormatHint = computed(() => {
  if (cropFormat.value === 'free') return 'Свободная рамка: пропорции можно менять вручную.'
  if (cropFormat.value === 'original') return 'Сохраняются исходные пропорции изображения.'
  return 'Форматы серии A имеют одинаковые пропорции; выбранная рамка подходит для страницы документа.'
})

watch(currentPreviewFile, () => resetPreviewView())
watch(mobileActionsMenuOpen, (isOpen) => {
  if (isOpen) nextTick(() => mobileActionsSheet.value?.focus())
})
watch(mobileFileListItems, (list) => {
  mobileListResizeObserver?.disconnect()
  mobileListResizeObserver = null

  if (!list) {
    mobileListScroll.visible = false
    return
  }

  mobileListResizeObserver = new ResizeObserver(scheduleMobileListScrollbarUpdate)
  mobileListResizeObserver.observe(list)
  scheduleMobileListScrollbarUpdate()
}, { flush: 'post' })
watch([uploadedCount, selectedCount], () => nextTick(scheduleMobileListScrollbarUpdate), { flush: 'post' })
watch(uploadedCount, (count) => {
  if (!count) mobilePreviewOpen.value = false
})

const failedHeading = computed(() => {
  const count = failedCount.value
  return fileWord(count) === 'файл' ? count + ' файл не загружен' : count + ' ' + fileWord(count) + ' не загружены'
})

function fileWord(count) {
  const value = Math.abs(count) % 100
  const last = value % 10
  if (value > 10 && value < 20) return 'файлов'
  if (last === 1) return 'файл'
  if (last > 1 && last < 5) return 'файла'
  return 'файлов'
}

function formatSize(bytes) {
  const value = bytes / MB
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
}

function extensionOf(name) {
  return name.includes('.') ? name.split('.').pop().toLowerCase() : ''
}

function inferType(name) {
  const extension = extensionOf(name)
  if (extension === 'pdf') return 'application/pdf'
  if (extension === 'png') return 'image/png'
  return 'image/jpeg'
}

function announce(message) {
  statusMessage.value = ''
  window.setTimeout(() => {
    statusMessage.value = message
  }, 20)
}

function resetPreviewView() {
  previewPage.value = 1
  previewZoom.value = 1
  previewPan.value = { x: 0, y: 0 }
  previewPointer.value = null
  cropMode.value = false
  crop.value = { x: 0, y: 0 }
  cropZoom.value = 1
  cropPixels.value = null
  cropFormat.value = 'original'
  cropImageRatio.value = 1
  previewError.value = ''
}

function navigatePreview(direction) {
  const target = currentPreviewIndex.value + direction
  if (target < 0 || target >= uploadedFiles.value.length) return
  previewIndex.value = target
}

function navigatePage(direction) {
  const target = previewPage.value + direction
  if (target < 1 || target > currentPreviewPageCount.value) return
  previewPage.value = target
  previewPan.value = { x: 0, y: 0 }
}

function setPreviewZoom(nextZoom) {
  previewZoom.value = Math.min(3, Math.max(0.5, Number(nextZoom)))
  if (previewZoom.value <= 1) previewPan.value = { x: 0, y: 0 }
}

function resetPreviewZoom() {
  previewZoom.value = 1
  previewPan.value = { x: 0, y: 0 }
}

function beginPreviewPan(event) {
  if (cropMode.value || previewZoom.value <= 1) return
  previewPointer.value = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    panX: previewPan.value.x,
    panY: previewPan.value.y,
  }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function movePreviewPan(event) {
  const pointer = previewPointer.value
  if (!pointer || pointer.id !== event.pointerId) return
  previewPan.value = {
    x: pointer.panX + event.clientX - pointer.startX,
    y: pointer.panY + event.clientY - pointer.startY,
  }
}

function endPreviewPan(event) {
  if (previewPointer.value?.id !== event.pointerId) return
  previewPointer.value = null
  event.currentTarget.releasePointerCapture?.(event.pointerId)
}

function startCropping() {
  const file = currentPreviewFile.value
  if (!currentPreviewIsImage.value || !file?.previewUrl) return
  cropMode.value = true
  crop.value = { x: 0, y: 0 }
  cropZoom.value = 1
  cropPixels.value = null
  cropFormat.value = 'original'
  cropImageRatio.value = 1

  const image = new Image()
  image.onload = () => {
    const ratio = image.naturalWidth / image.naturalHeight
    const portraitRatio = 1 / Math.sqrt(2)
    const landscapeRatio = Math.sqrt(2)
    cropImageRatio.value = ratio
    cropFormat.value = Math.abs(ratio - portraitRatio) <= Math.abs(ratio - landscapeRatio)
      ? 'a4-portrait'
      : 'a4-landscape'
    if (Math.min(Math.abs(ratio - portraitRatio), Math.abs(ratio - landscapeRatio)) > 0.12) {
      cropFormat.value = 'original'
    }
  }
  image.src = file.previewUrl
  nextTick(() => cropDialog.value?.focus())
}

function cancelCropping() {
  cropMode.value = false
  cropPixels.value = null
}

function changeCropFormat() {
  crop.value = { x: 0, y: 0 }
  cropZoom.value = 1
  cropPixels.value = null
}

function setCropZoom(nextZoom) {
  cropZoom.value = Math.min(3, Math.max(1, Number(nextZoom)))
}

function applyCrop() {
  const file = currentPreviewFile.value
  const area = cropPixels.value
  if (!file?.previewUrl || !area) return cancelCropping()

  const image = new Image()
  image.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(area.width)
    canvas.height = Math.round(area.height)
    const context = canvas.getContext('2d')
    context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) return
      if (file.previewUrl.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl)
      file.previewUrl = URL.createObjectURL(blob)
      cropMode.value = false
      cropPixels.value = null
      announce('Кадрирование изображения применено.')
    }, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92)
  }
  image.src = file.previewUrl
}

function handlePdfLoaded(pageCount) {
  const file = currentPreviewFile.value
  if (!file) return
  pdfPageCounts.value = { ...pdfPageCounts.value, [file.id]: pageCount }
  file.pages = pageCount
}

function handlePdfError(error) {
  console.error('Не удалось отобразить PDF', error)
  previewError.value = 'Не удалось открыть PDF. Попробуйте загрузить файл ещё раз.'
}

function openFilePicker() {
  fileInput.value?.click()
}

function openMobilePreview() {
  mobileActionsMenuOpen.value = false
  previewEnabled.value = true
  if (!currentPreviewFile.value) {
    announce('Добавьте файл, чтобы открыть предпросмотр.')
    return
  }

  mobilePreviewOpen.value = true
  nextTick(() => mobilePreviewDialog.value?.focus())
  announce('Предпросмотр файлов открыт.')
}

async function closeMobilePreview() {
  try {
    if (document.fullscreenElement === mobilePreviewDialog.value) {
      await document.exitFullscreen?.()
    }
  } finally {
    mobilePreviewOpen.value = false
    announce('Предпросмотр файлов закрыт.')
  }
}

async function toggleMobilePreviewFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen?.()
    else await mobilePreviewDialog.value?.requestFullscreen?.()
  } catch {
    announce('Полноэкранный режим недоступен в этом браузере.')
  }
}

function trapMobilePreviewFocus(event) {
  const dialog = mobilePreviewDialog.value
  if (!dialog) return
  const focusable = [...dialog.querySelectorAll('button:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
  if (!focusable.length) return

  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function clearPackageFromMobileSheet() {
  mobileActionsMenuOpen.value = false
  clearPackage()
}

function showUploadPanel(expand = true) {
  uploadPanelDismissed.value = false
  if (expand) uploadPanelExpanded.value = true
}

function closeUploadPanel() {
  uploadPanelDismissed.value = true
}

function createUploadActivity(source, options = {}) {
  const activity = reactive({
    id: options.id ?? nextId++,
    name: source.name,
    size: source.size,
    type: source.type || inferType(source.name),
    pages: source.pages,
    progress: options.progress ?? 0,
    status: options.status || 'uploading',
    reason: options.reason || '',
    source,
  })
  uploadActivities.value.push(activity)
  return activity
}

function existingNames() {
  return new Set([
    ...uploadedFiles.value.map((file) => file.name.toLowerCase()),
    ...uploadQueue.value.map((file) => file.name.toLowerCase()),
  ])
}

function takeFailedFileByName(name) {
  const failed = failedFiles.value.find((file) => file.name.toLowerCase() === name.toLowerCase())
  if (!failed) return null

  failedFiles.value = failedFiles.value.filter((file) => file.id !== failed.id)
  return uploadActivities.value.find((activity) => activity.id === failed.id)
    || createUploadActivity(failed.source, {
      id: failed.id,
      status: 'error',
      progress: 100,
      reason: failed.reason,
    })
}

function validateFile(file) {
  const extension = extensionOf(file.name)
  if (!allowedExtensions.includes(extension)) {
    return 'Формат .' + (extension || '—') + ' не поддерживается'
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'Размер файла превышает 20 МБ'
  }
  if (existingNames().has(file.name.toLowerCase())) {
    return 'Файл с таким именем уже добавлен'
  }
  return ''
}

function addFiles(files) {
  if (!files.length) return
  if (!isUploading.value) {
    uploadActivities.value = statusDisplayMode === 'popover'
      ? failedFiles.value.map(toFailedUploadActivity)
      : []
  }
  packageSent.value = false
  showUploadPanel()

  let added = 0
  let rejected = 0

  files.forEach((file) => {
    const validationError = validateFile(file)
    if (validationError) {
      const activity = createUploadActivity(file, {
        status: 'error',
        progress: 100,
        reason: validationError,
      })
      failedFiles.value.push({
        id: activity.id,
        name: file.name,
        size: file.size,
        type: file.type || inferType(file.name),
        reason: validationError,
        source: file,
      })
      errorAlertDismissed.value = false
      errorAlertExpanded.value = false
      rejected += 1
      return
    }

    const replacementActivity = takeFailedFileByName(file.name)
    startUpload(file, { recovery: Boolean(replacementActivity), activity: replacementActivity })
    added += 1
  })

  if (rejected) focusErrorSummary()
  announce(
    added && rejected
      ? added + ' ' + fileWord(added) + ' загружаются, ' + rejected + ' отклонены.'
      : rejected
        ? rejected + ' ' + fileWord(rejected) + ' не прошли проверку.'
        : 'Началась загрузка ' + added + ' ' + fileWord(added) + '.',
  )
}

function handleFileInput(event) {
  addFiles(Array.from(event.target.files || []))
  event.target.value = ''
}

function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

function handleTableDragEnter(event) {
  if (!hasDraggedFiles(event)) return
  tableDragDepth += 1
  dragActive.value = true
}

function handleTableDragOver(event) {
  if (!hasDraggedFiles(event)) return
  dragActive.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function handleTableDragLeave() {
  tableDragDepth = Math.max(0, tableDragDepth - 1)
  if (tableDragDepth === 0) dragActive.value = false
}

function handleTableDrop(event) {
  tableDragDepth = 0
  dragActive.value = false
  if (!hasDraggedFiles(event)) return
  addFiles(Array.from(event.dataTransfer?.files || []))
}

function startUpload(source, options = {}) {
  const item = options.activity || createUploadActivity(source)
  Object.assign(item, {
    name: source.name,
    size: source.size,
    type: source.type || inferType(source.name),
    pages: source.pages,
    progress: 4,
    status: 'uploading',
    reason: '',
    source,
  })

  if (!uploadActivities.value.some((activity) => activity.id === item.id)) uploadActivities.value.push(item)
  showUploadPanel()

  const failFirstAttempt = !options.recovery && /(?:error|fail|ошибка)/i.test(item.name)
  uploadQueue.value.push(item)

  const timer = window.setInterval(() => {
    item.progress = Math.min(100, item.progress + 11 + Math.floor(Math.random() * 12))

    if (failFirstAttempt && item.progress >= 70) {
      stopUploadTimer(item.id)
      uploadQueue.value = uploadQueue.value.filter((file) => file.id !== item.id)
      const reason = 'Соединение прервано. Добавьте файл снова.'
      item.status = 'error'
      item.reason = reason
      failedFiles.value.push({
        id: item.id,
        name: item.name,
        size: item.size,
        type: item.type,
        pages: item.pages,
        reason,
        source: item.source,
      })
      errorAlertDismissed.value = false
      errorAlertExpanded.value = false
      announce('Не удалось загрузить файл ' + item.name + '.')
      focusErrorSummary()
      return
    }

    if (item.progress >= 100) completeUpload(item)
  }, 150)

  timers.set(item.id, timer)
}

function stopUploadTimer(id) {
  const timer = timers.get(id)
  if (timer) window.clearInterval(timer)
  timers.delete(id)
}

function completeUpload(item) {
  stopUploadTimer(item.id)
  uploadQueue.value = uploadQueue.value.filter((file) => file.id !== item.id)
  item.progress = 100
  item.status = 'success'
  item.reason = ''
  const type = item.type || inferType(item.name)
  const previewUrl = item.source ? URL.createObjectURL(item.source) : ''
  uploadedFiles.value.push({
    id: nextId++,
    name: item.name,
    size: item.size,
    type,
    pages: item.pages ?? 1,
    previewUrl,
    source: item.source,
  })
  announce('Файл ' + item.name + ' загружен и добавлен в пакет.')
}

function cancelUpload(item) {
  stopUploadTimer(item.id)
  uploadQueue.value = uploadQueue.value.filter((file) => file.id !== item.id)
  const reason = 'Загрузка отменена. Добавьте файл снова, когда будете готовы.'
  item.status = 'error'
  item.reason = reason
  failedFiles.value.push({
    id: item.id,
    name: item.name,
    size: item.size,
    type: item.type,
    pages: item.pages,
    reason,
    source: item.source,
  })
  errorAlertDismissed.value = false
  errorAlertExpanded.value = false
  announce('Загрузка файла ' + item.name + ' отменена.')
  focusErrorSummary()
}

function focusErrorSummary() {
  nextTick(() => errorSummary.value?.focus())
}

function dismissErrorAlert() {
  errorAlertDismissed.value = true
}

function toggleErrorAlert() {
  errorAlertExpanded.value = !errorAlertExpanded.value
}

function deleteFile(id) {
  requestDeletion([id])
}

function deleteSelected() {
  if (!selectedIds.value.length) return
  requestDeletion(selectedIds.value)
}

function requestDeletion(ids) {
  const available = new Set(uploadedFiles.value.map((file) => file.id))
  pendingDeletionIds.value = ids.filter((id) => available.has(id))
  if (!pendingDeletionIds.value.length) return
  nextTick(() => deleteDialog.value?.focus())
}

function cancelDeletion() {
  pendingDeletionIds.value = []
}

function confirmDeletion() {
  const files = filesPendingDeletion.value
  if (!files.length) return cancelDeletion()

  const pending = new Set(files.map((file) => file.id))
  files.forEach((file) => {
    if (file.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl)
  })
  uploadedFiles.value = uploadedFiles.value.filter((file) => !pending.has(file.id))
  previewIndex.value = Math.min(previewIndex.value, Math.max(0, uploadedFiles.value.length - 1))
  selectedIds.value = []
  pendingDeletionIds.value = []
  announce(files.length === 1
    ? 'Файл ' + files[0].name + ' удалён из пакета.'
    : 'Из пакета удалено ' + files.length + ' ' + fileWord(files.length) + '.')
}

function moveSelected(direction) {
  const moveUp = direction < 0
  if ((moveUp && !canMoveSelectionUp.value) || (!moveUp && !canMoveSelectionDown.value)) return

  const next = [...uploadedFiles.value]
  const selected = selectedIdSet.value

  if (moveUp) {
    for (let index = 1; index < next.length; index += 1) {
      if (selected.has(next[index].id) && !selected.has(next[index - 1].id)) {
        ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      }
    }
  } else {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (selected.has(next[index].id) && !selected.has(next[index + 1].id)) {
        ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      }
    }
  }

  uploadedFiles.value = next
  keepMovedSelectionVisible(direction)
  announce(selectedCount.value === 1
    ? `Файл перемещён ${moveUp ? 'выше' : 'ниже'}.`
    : `Выбранные файлы перемещены ${moveUp ? 'выше' : 'ниже'}.`)
}

function keepMovedSelectionVisible(direction) {
  nextTick(() => {
    const list = mobileFileListItems.value
    if (!list) return

    const orderedSelection = uploadedFiles.value.filter((file) => selectedIdSet.value.has(file.id))
    const edgeFile = direction < 0 ? orderedSelection[0] : orderedSelection.at(-1)
    const item = edgeFile ? list.querySelector(`[data-file-id="${edgeFile.id}"]`) : null
    if (!item) return

    const listRect = list.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    const visibleBottom = listRect.bottom - (selectedCount.value ? 72 : 0)
    if (itemRect.top < listRect.top) list.scrollTop -= listRect.top - itemRect.top
    if (itemRect.bottom > visibleBottom) list.scrollTop += itemRect.bottom - visibleBottom
    scheduleMobileListScrollbarUpdate()
  })
}

function updateMobileListScrollbar() {
  const list = mobileFileListItems.value
  if (!list) {
    mobileListScroll.visible = false
    return
  }

  const viewportHeight = list.clientHeight
  const contentHeight = list.scrollHeight
  const trackHeight = Math.max(0, viewportHeight - 24)
  const maxScroll = Math.max(0, contentHeight - viewportHeight)
  const visible = maxScroll > 1 && trackHeight > 0

  mobileListScroll.visible = visible
  if (!visible) return

  const thumbHeight = Math.min(trackHeight, Math.max(56, trackHeight * viewportHeight / contentHeight))
  const maxThumbOffset = trackHeight - thumbHeight
  mobileListScroll.thumbHeight = thumbHeight
  mobileListScroll.thumbOffset = maxThumbOffset * list.scrollTop / maxScroll
}

function scheduleMobileListScrollbarUpdate() {
  if (mobileListScrollFrame) return
  mobileListScrollFrame = window.requestAnimationFrame(() => {
    mobileListScrollFrame = 0
    updateMobileListScrollbar()
  })
}

function clearPackage() {
  if (!uploadedFiles.value.length && !failedFiles.value.length && !uploadQueue.value.length) return
  if (!window.confirm('Удалить все файлы из пакета и очереди загрузки?')) return
  timers.forEach((timer) => window.clearInterval(timer))
  timers.clear()
  uploadedFiles.value.forEach((file) => {
    if (file.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl)
  })
  uploadedFiles.value = []
  uploadQueue.value = []
  uploadActivities.value = []
  uploadPanelDismissed.value = true
  uploadPanelExpanded.value = true
  failedFiles.value = []
  errorAlertDismissed.value = false
  errorAlertExpanded.value = false
  selectedIds.value = []
  packageSent.value = false
  announce('Пакет очищен.')
}

function saveDraft() {
  draftSaved.value = true
  announce('Черновик сохранён. Состояние загрузки зафиксировано.')
}

function sendPackage() {
  if (!canSend.value) {
    return
  }
  packageSent.value = true
  announce('Пакет из ' + uploadedCount.value + ' ' + fileWord(uploadedCount.value) + ' готов к отправке.')
}

onBeforeUnmount(() => {
  timers.forEach((timer) => window.clearInterval(timer))
  mobileListResizeObserver?.disconnect()
  if (mobileListScrollFrame) window.cancelAnimationFrame(mobileListScrollFrame)
  uploadedFiles.value.forEach((file) => {
    if (file.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl)
  })
})
</script>

<template>
  <div class="app-shell">
    <svg class="icon-sprite" aria-hidden="true">
      <symbol id="i-arrow-up" viewBox="0 0 24 24"><path d="m6 10 6-6 6 6M12 4v16" /></symbol>
      <symbol id="i-arrow-down" viewBox="0 0 24 24"><path d="m6 14 6 6 6-6M12 20V4" /></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></symbol>
      <symbol id="i-check-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m8 12 2.6 2.6L16.5 9" /></symbol>
      <symbol id="i-error-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v6M12 17v.5" /></symbol>
      <symbol id="i-chevron" viewBox="0 0 24 24"><path d="m8 10 4 4 4-4" /></symbol>
      <symbol id="i-chevron-left" viewBox="0 0 24 24"><path d="m14.5 5-7 7 7 7" /></symbol>
      <symbol id="i-chevron-right" viewBox="0 0 24 24"><path d="m9.5 5 7 7-7 7" /></symbol>
      <symbol id="i-close" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></symbol>
      <symbol id="i-crop" viewBox="0 0 24 24"><path d="M7 3v14a4 4 0 0 0 4 4h10M17 21V7a4 4 0 0 0-4-4H3M3 7h18" /></symbol>
      <symbol id="i-file" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 13h6M9 17h4" /></symbol>
      <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></symbol>
      <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></symbol>
      <symbol id="i-more" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" /></symbol>
      <symbol id="i-logout" viewBox="0 0 24 24"><path d="M14 8V4H5v16h9v-4M10 12h10M17 9l3 3-3 3" /></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5M18.5 9A7 7 0 0 0 6.4 6.4L4 9M5.5 15A7 7 0 0 0 17.6 17.6L20 15" /></symbol>
      <symbol id="i-save" viewBox="0 0 24 24"><path d="M4 4h13l3 3v13H4zM8 4v6h8V4M8 20v-6h8v6" /></symbol>
      <symbol id="i-send" viewBox="0 0 24 24"><path d="m3 4 18 8-18 8 3-8zM6 12h15" /></symbol>
      <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></symbol>
      <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></symbol>
      <symbol id="i-warning" viewBox="0 0 24 24"><path d="M12 3 2.5 20h19zM12 9v5M12 17.5v.5" /></symbol>
      <symbol id="i-zoom-in" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4M10.5 7.5v6M7.5 10.5h6" /></symbol>
      <symbol id="i-zoom-out" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4M7.5 10.5h6" /></symbol>
      <symbol id="i-expand" viewBox="0 0 24 24"><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5" /></symbol>
    </svg>

    <header class="topbar">
      <a href="#" class="brand" aria-label="DNS ОЦИФРОВКА — главная">
        <img class="brand__logo brand__logo--desktop" src="/DNS%20SDD%20Logo.svg" width="182" height="34" alt="" />
        <span class="mobile-brand" aria-hidden="true">
          <span class="mobile-brand__mark"><img src="/DNS%20SDD%20Logo.svg" alt="" /></span>
          <span class="mobile-brand__label">ОЦИФРОВКА</span>
        </span>
      </a>

      <div class="topbar__navigation">
        <nav class="main-nav" aria-label="Разделы">
          <a class="main-nav__item main-nav__item--active" href="#">Загрузка документов</a>
          <a class="main-nav__item" href="#">Черновики</a>
          <a class="main-nav__item" href="#">Статусы документооборота</a>
        </nav>
      </div>

      <div class="user-area">
        <a class="help-link" href="#upload-help">Помощь</a>
        <button class="logout-button" type="button">
          <svg class="icon"><use href="#i-logout" /></svg>
          Выйти
        </button>
      </div>
      <a class="mobile-header-help" href="#upload-help">Помощь</a>
      <button class="mobile-menu-button" type="button" aria-label="Выйти">
        <svg class="icon"><use href="#i-logout" /></svg>
      </button>
    </header>

    <main class="page">
      <section class="package-card" :class="{ 'package-card--empty': !uploadedFiles.length }" aria-labelledby="package-title">
        <header class="package-header">
          <div class="package-title-group">
            <h1 id="package-title">Пакет документов <span class="mobile-file-count">({{ uploadedCount }})</span></h1>
            <span class="count-badge">Файлов: {{ uploadedCount }}</span>
            <button
              v-if="uploadedFiles.length"
              class="icon-button mobile-package-actions-trigger"
              type="button"
              aria-label="Дополнительные действия с пакетом"
              aria-haspopup="menu"
              aria-controls="mobile-actions-sheet"
              :aria-expanded="mobileActionsMenuOpen"
              @click="mobileActionsMenuOpen = !mobileActionsMenuOpen"
            >
              <svg class="icon"><use href="#i-more" /></svg>
            </button>
          </div>

          <div class="package-actions">
            <div class="package-actions__buttons">
              <label class="switch-control">
                <input v-model="previewEnabled" type="checkbox" />
                <span class="switch" aria-hidden="true"><span /></span>
                <span>Предпросмотр файлов</span>
              </label>

              <button class="button button--secondary" type="button" @click="saveDraft">
                <svg class="icon"><use href="#i-save" /></svg>
                {{ draftSaved ? 'Черновик сохранён' : 'Сохранить черновик' }}
              </button>

              <button class="button button--primary" type="button" :disabled="!canSend" @click="sendPackage">
                <svg class="icon"><use href="#i-send" /></svg>
                {{ packageSent ? 'Пакет готов' : 'Отправить пакет' }}
              </button>
            </div>
          </div>
        </header>

        <div class="package-workspace">
          <aside
            id="file-preview-area"
            class="preview-pane"
            :class="{ 'preview-pane--visible': previewEnabled && currentPreviewFile }"
            aria-label="Предпросмотр файлов"
          />

        <div class="package-body" :aria-busy="isUploading">
          <div class="toolbar">
            <div class="toolbar__selection" aria-label="Действия с выбранными файлами">
              <button class="icon-button" type="button" :disabled="!canMoveSelectionUp" :aria-label="selectedCount === 1 ? 'Переместить выбранный файл вверх' : 'Переместить выбранные файлы вверх'" @click="moveSelected(-1)">
                <svg class="icon"><use href="#i-arrow-up" /></svg>
              </button>
              <button class="icon-button" type="button" :disabled="!canMoveSelectionDown" :aria-label="selectedCount === 1 ? 'Переместить выбранный файл вниз' : 'Переместить выбранные файлы вниз'" @click="moveSelected(1)">
                <svg class="icon"><use href="#i-arrow-down" /></svg>
              </button>
              <button class="button button--danger-quiet" type="button" :disabled="!selectedIds.length" @click="deleteSelected">
                <svg class="icon"><use href="#i-trash" /></svg>
                Удалить выбранные<span v-if="selectedIds.length"> ({{ selectedIds.length }})</span>
              </button>
            </div>

            <div class="toolbar__upload">
              <button class="button button--secondary button--compact" type="button" @click="clearPackage">
                <svg class="icon"><use href="#i-refresh" /></svg>
                Очистить пакет
              </button>
              <button class="button button--primary button--compact" type="button" @click="openFilePicker">
                <svg class="icon"><use href="#i-plus" /></svg>
                Добавить файлы
              </button>
              <input
                ref="fileInput"
                class="visually-hidden"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                multiple
                @change="handleFileInput"
              />
            </div>
          </div>

          <Teleport v-if="previewEnabled && currentPreviewFile && !mobilePreviewOpen" to="#file-preview-area">
          <section class="file-preview" aria-label="Предпросмотр файла">
            <header class="file-preview__header">
              <div class="file-preview__file-select">
                <span>Файл:</span>
                <button class="file-preview__file-name" type="button" :title="currentPreviewFile.name">
                  {{ currentPreviewFile.name }}
                  <svg class="icon" aria-hidden="true"><use href="#i-chevron" /></svg>
                </button>
              </div>

              <div class="file-preview__file-nav" aria-label="Переключение файлов">
                <button class="icon-button icon-button--preview" type="button" :disabled="currentPreviewIndex <= 0" aria-label="Предыдущий файл" @click="navigatePreview(-1)">
                  <svg class="icon"><use href="#i-chevron-left" /></svg>
                </button>
                <span>Файл {{ currentPreviewIndex + 1 }}/{{ uploadedFiles.length }}</span>
                <button class="icon-button icon-button--preview" type="button" :disabled="currentPreviewIndex >= uploadedFiles.length - 1" aria-label="Следующий файл" @click="navigatePreview(1)">
                  <svg class="icon"><use href="#i-chevron-right" /></svg>
                </button>
              </div>
            </header>

            <div class="file-preview__canvas" :class="{ 'file-preview__canvas--pannable': previewZoom > 1, 'file-preview__canvas--panning': previewPointer }" @pointerdown="beginPreviewPan" @pointermove="movePreviewPan" @pointerup="endPreviewPan" @pointercancel="endPreviewPan">
              <div class="file-preview__media" :style="{ transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})` }">
                <img v-if="currentPreviewIsImage" :src="currentPreviewFile.previewUrl" :alt="'Предпросмотр ' + currentPreviewFile.name" draggable="false" />
                <PdfPreview v-else :url="currentPreviewFile.previewUrl" :source="currentPreviewFile.source" :page="previewPage" @loaded="handlePdfLoaded" @page-change="previewPage = $event" @error="handlePdfError" />
              </div>
              <p v-if="previewError" class="file-preview__error" role="alert">{{ previewError }}</p>
            </div>

            <footer class="file-preview__controls" :class="{ 'file-preview__controls--image': currentPreviewIsImage }">
              <div class="file-preview__view-tools">
                <div class="file-preview__zoom" aria-label="Масштаб предпросмотра">
                  <button class="icon-button icon-button--preview" type="button" :disabled="previewZoom <= 0.5" aria-label="Уменьшить масштаб" @click="setPreviewZoom(previewZoom - 0.25)">
                    <svg class="icon"><use href="#i-zoom-out" /></svg>
                  </button>
                  <output>{{ previewZoomPercent }}%</output>
                  <button class="icon-button icon-button--preview" type="button" :disabled="previewZoom >= 3" aria-label="Увеличить масштаб" @click="setPreviewZoom(previewZoom + 0.25)">
                    <svg class="icon"><use href="#i-zoom-in" /></svg>
                  </button>
                </div>
                <button class="icon-button icon-button--preview" type="button" aria-label="Сбросить масштаб и положение" @click="resetPreviewZoom">
                  <svg class="icon"><use href="#i-refresh" /></svg>
                </button>
              </div>

              <div v-if="!currentPreviewIsImage" class="file-preview__page-nav" aria-label="Переключение страниц">
                <button class="icon-button icon-button--preview" type="button" :disabled="previewPage <= 1" aria-label="Предыдущая страница" @click="navigatePage(-1)">
                  <svg class="icon"><use href="#i-chevron-left" /></svg>
                </button>
                <span>Стр. {{ previewPage }}/{{ currentPreviewPageCount }}</span>
                <button class="icon-button icon-button--preview" type="button" :disabled="previewPage >= currentPreviewPageCount" aria-label="Следующая страница" @click="navigatePage(1)">
                  <svg class="icon"><use href="#i-chevron-right" /></svg>
                </button>
              </div>

              <div v-if="currentPreviewIsImage" class="file-preview__crop-actions">
                <button class="button button--secondary button--compact" type="button" @click="startCropping">
                  <svg class="icon"><use href="#i-crop" /></svg>
                  Кадрировать
                </button>
              </div>
            </footer>
          </section>
          </Teleport>

          <div
            class="upload-drop-zone"
            :class="{ 'upload-drop-zone--dragging': dragActive }"
            role="region"
            aria-label="Область загрузки файлов"
            @dragenter.prevent.stop="handleTableDragEnter"
            @dragover.prevent.stop="handleTableDragOver"
            @dragleave.prevent.stop="handleTableDragLeave"
            @drop.prevent.stop="handleTableDrop"
          >
          <section
            v-if="failedFiles.length && !errorAlertDismissed && statusDisplayMode !== 'popover'"
            ref="errorSummary"
            class="upload-errors"
            :class="{ 'upload-errors--expanded': errorAlertExpanded }"
            role="alert"
            tabindex="-1"
            aria-labelledby="upload-errors-title"
          >
            <div class="status-panel__header">
              <div class="status-panel__title">
                <svg class="icon upload-errors__icon" aria-hidden="true"><use href="#i-error-circle" /></svg>
                <h2 id="upload-errors-title">{{ failedHeading }}</h2>
              </div>
              <div class="status-panel__actions">
                <button class="icon-button icon-button--alert-close" type="button" aria-label="Закрыть уведомление об ошибке загрузки" @click="dismissErrorAlert">
                  <svg class="icon"><use href="#i-close" /></svg>
                </button>
              </div>
            </div>

            <p class="upload-errors__description">Эти файлы не добавлены в пакет и не будут отправлены. Попробуйте добавить их еще раз.</p>

            <ul v-show="errorAlertExpanded" id="upload-errors-list" class="error-list">
              <li v-for="file in failedFiles" :key="file.id" class="error-list__item">
                <div class="error-list__content">
                  <strong :title="file.name">{{ file.name }}</strong>
                  <span>{{ file.reason }}</span>
                </div>
                <span class="error-list__size">{{ formatSize(file.size) }} МБ</span>
              </li>
            </ul>

            <button
              class="upload-errors__toggle"
              type="button"
              :aria-expanded="errorAlertExpanded"
              aria-controls="upload-errors-list"
              @click="toggleErrorAlert"
            >
              {{ errorAlertExpanded ? 'Свернуть' : 'Подробнее' }}
              <svg class="icon" :class="{ 'upload-errors__toggle-icon--expanded': errorAlertExpanded }"><use href="#i-chevron" /></svg>
            </button>
          </section>

          <div class="files-table-wrap">
            <table class="files-table">
              <thead>
                <tr>
                  <th class="cell-check">
                    <label class="checkbox-control">
                      <input v-model="allSelected" type="checkbox" :disabled="!uploadedFiles.length" />
                      <span aria-hidden="true"><svg class="icon icon--sm"><use href="#i-check" /></svg></span>
                      <span class="visually-hidden">Выбрать все файлы в пакете</span>
                    </label>
                  </th>
                  <th>Имя файла</th>
                  <th class="cell-size">Размер файла, МБ</th>
                  <th class="cell-pages">Кол-во страниц</th>
                  <th class="cell-actions">Действия</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(file, index) in uploadedFiles"
                  :key="file.id"
                  :class="{ 'files-table__row--selected': selectedIds.includes(file.id), 'files-table__row--previewed': previewEnabled && index === currentPreviewIndex }"
                  @click="previewEnabled && (previewIndex = index)"
                >
                  <td class="cell-check">
                    <label class="checkbox-control">
                      <input v-model="selectedIds" type="checkbox" :value="file.id" />
                      <span aria-hidden="true"><svg class="icon icon--sm"><use href="#i-check" /></svg></span>
                      <span class="visually-hidden">Выбрать {{ file.name }}</span>
                    </label>
                  </td>
                  <td>
                    <div class="file-name-cell">
                      <span :title="file.name">{{ file.name }}</span>
                    </div>
                  </td>
                  <td class="cell-size">{{ formatSize(file.size) }}</td>
                  <td class="cell-pages">{{ file.pages }}</td>
                  <td class="cell-actions">
                    <button class="icon-button icon-button--table" type="button" :aria-label="'Удалить ' + file.name" @click="deleteFile(file.id)">
                      <svg class="icon"><use href="#i-trash" /></svg>
                    </button>
                  </td>
                </tr>
                <tr v-if="!uploadedFiles.length" class="empty-row">
                  <td colspan="5">
                    <div class="empty-state">
                      <span class="empty-state__icon"><svg class="icon"><use href="#i-file" /></svg></span>
                      <strong>В пакете пока нет файлов</strong>
                      <span>Добавьте документы — успешно загруженные файлы появятся здесь.</span>
                      <button class="button button--primary button--compact" type="button" @click="openFilePicker">
                        <svg class="icon"><use href="#i-plus" /></svg>
                        Добавить файлы
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <section v-if="uploadedFiles.length" class="mobile-file-list" aria-label="Файлы в пакете">
            <header class="mobile-file-list__header">
              <label class="mobile-checkbox" :class="{ 'mobile-checkbox--indeterminate': hasPartialSelection }">
                <input v-model="allSelected" type="checkbox" :disabled="!uploadedFiles.length" />
                <span aria-hidden="true"><svg class="icon icon--sm"><use href="#i-check" /></svg></span>
                <span>Выбрать все</span>
              </label>
              <button class="button button--primary mobile-file-list__add" type="button" @click="openFilePicker">Добавить файлы</button>
            </header>

            <ul ref="mobileFileListItems" class="mobile-file-list__items" :class="{ 'mobile-file-list__items--selection-active': selectedCount }" @scroll.passive="scheduleMobileListScrollbarUpdate">
              <li v-for="file in uploadedFiles" :key="file.id" class="mobile-file-list__item" :data-file-id="file.id">
                <label class="mobile-checkbox">
                  <input v-model="selectedIds" type="checkbox" :value="file.id" />
                  <span aria-hidden="true"><svg class="icon icon--sm"><use href="#i-check" /></svg></span>
                  <span class="visually-hidden">Выбрать {{ file.name }}</span>
                </label>
                <div class="mobile-file-list__file">
                  <strong :title="file.name">{{ file.name }}</strong>
                  <small>{{ formatSize(file.size) }} МБ • {{ file.pages }} стр.</small>
                </div>
                <button class="icon-button mobile-file-list__delete" type="button" :aria-label="'Удалить ' + file.name" @click="deleteFile(file.id)">
                  <svg class="icon"><use href="#i-trash" /></svg>
                </button>
              </li>
            </ul>
            <div v-if="mobileListScroll.visible" class="mobile-file-list__scrollbar" aria-hidden="true">
              <span
                class="mobile-file-list__scrollbar-thumb"
                :style="{
                  height: `${mobileListScroll.thumbHeight}px`,
                  transform: `translateY(${mobileListScroll.thumbOffset}px)`,
                }"
              />
            </div>
          </section>

          <section v-else class="mobile-empty-state" aria-labelledby="mobile-empty-title">
            <div class="mobile-empty-state__text">
              <h2 id="mobile-empty-title">В пакете пока нет документов</h2>
              <p>Поддерживаются PDF, JPG, JPEG и PNG.</p>
            </div>
            <button class="button button--primary mobile-empty-state__add" type="button" @click="openFilePicker">
              Добавить файлы
            </button>
          </section>
          <div v-if="dragActive" class="upload-drop-overlay" role="status" aria-live="polite">
            <span class="upload-drop-overlay__message">Перемещенные файлы будут добавлены в пакет</span>
          </div>
          <a v-if="!uploadedFiles.length" id="upload-help" class="help-link package-help" href="#">Как загружать документы</a>
          </div>
        </div>
        </div>
      </section>
    </main>

    <aside v-if="selectedCount" class="mobile-selection-bar" aria-label="Действия с выбранными файлами">
      <div class="mobile-selection-bar__moves">
        <button class="icon-button" type="button" :disabled="!canMoveSelectionUp" :aria-label="selectedCount === 1 ? 'Переместить выбранный файл вверх' : 'Переместить выбранные файлы вверх'" @click="moveSelected(-1)"><svg class="icon"><use href="#i-arrow-up" /></svg></button>
        <button class="icon-button" type="button" :disabled="!canMoveSelectionDown" :aria-label="selectedCount === 1 ? 'Переместить выбранный файл вниз' : 'Переместить выбранные файлы вниз'" @click="moveSelected(1)"><svg class="icon"><use href="#i-arrow-down" /></svg></button>
      </div>
      <button class="text-button text-button--danger" type="button" @click="deleteSelected">Удалить выбранные ({{ selectedCount }})</button>
    </aside>

    <div v-if="uploadedFiles.length" class="mobile-primary-actions">
      <button class="button button--secondary mobile-primary-actions__draft" type="button" @click="saveDraft">{{ draftSaved ? 'Сохранено' : 'Сохранить' }}</button>
      <button class="button button--primary mobile-primary-actions__send" type="button" :disabled="!canSend" @click="sendPackage">Отправить</button>
    </div>

    <Transition name="mobile-actions-backdrop">
      <div v-if="mobileActionsMenuOpen" class="mobile-action-sheet-backdrop" aria-hidden="true" @click="mobileActionsMenuOpen = false" />
    </Transition>
    <Transition name="mobile-actions-menu">
      <section
        v-if="mobileActionsMenuOpen"
        ref="mobileActionsSheet"
        id="mobile-actions-sheet"
        class="mobile-actions-popover"
        role="menu"
        aria-labelledby="mobile-actions-sheet-title"
        tabindex="-1"
        @keydown.esc="mobileActionsMenuOpen = false"
      >
        <h2 id="mobile-actions-sheet-title" class="visually-hidden">Действия с пакетом</h2>
        <button type="button" role="menuitem" @click="openMobilePreview">Предпросмотр</button>
        <button class="mobile-actions-popover__clear" type="button" role="menuitem" @click="clearPackageFromMobileSheet">Очистить все</button>
      </section>
    </Transition>

    <Teleport to="body">
      <section
        v-if="mobilePreviewOpen && currentPreviewFile"
        ref="mobilePreviewDialog"
        class="mobile-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-preview-title"
        tabindex="-1"
        @keydown.esc="closeMobilePreview"
        @keydown.tab="trapMobilePreviewFocus"
      >
        <header class="mobile-preview-dialog__header">
          <h2 id="mobile-preview-title">Предпросмотр файлов</h2>
          <button class="mobile-preview-dialog__close" type="button" aria-label="Закрыть предпросмотр" @click="closeMobilePreview">
            <svg class="icon"><use href="#i-close" /></svg>
          </button>
        </header>

        <main class="mobile-preview-dialog__body">
          <label class="mobile-preview-dialog__file-select" :title="currentPreviewFile.name">
            <span class="visually-hidden">Файл для предпросмотра</span>
            <select v-model="previewIndex" aria-label="Файл для предпросмотра">
              <option v-for="(file, index) in uploadedFiles" :key="file.id" :value="index">{{ file.name }}</option>
            </select>
            <svg class="icon" aria-hidden="true"><use href="#i-chevron" /></svg>
          </label>

          <div class="mobile-preview-dialog__file-nav">
            <span>Файл {{ currentPreviewIndex + 1 }} из {{ uploadedFiles.length }}</span>
            <div aria-label="Переключение файлов">
              <button class="mobile-preview-dialog__icon-button" type="button" :disabled="currentPreviewIndex <= 0" aria-label="Предыдущий файл" @click="navigatePreview(-1)">
                <svg class="icon"><use href="#i-chevron-left" /></svg>
              </button>
              <button class="mobile-preview-dialog__icon-button" type="button" :disabled="currentPreviewIndex >= uploadedFiles.length - 1" aria-label="Следующий файл" @click="navigatePreview(1)">
                <svg class="icon"><use href="#i-chevron-right" /></svg>
              </button>
            </div>
          </div>

          <div class="mobile-preview-dialog__stage">
            <div v-if="currentPreviewIsImage" class="mobile-preview-dialog__image-scroll">
              <img
                :src="currentPreviewFile.previewUrl"
                :alt="'Предпросмотр ' + currentPreviewFile.name"
                :style="{ width: `${previewZoom * 100}%` }"
                draggable="false"
              />
            </div>
            <PdfPreview
              v-else
              :url="currentPreviewFile.previewUrl"
              :source="currentPreviewFile.source"
              :page="previewPage"
              :zoom="previewZoom"
              @loaded="handlePdfLoaded"
              @page-change="previewPage = $event"
              @error="handlePdfError"
            />
            <p v-if="previewError" class="mobile-preview-dialog__error" role="alert">{{ previewError }}</p>
          </div>
        </main>

        <footer class="mobile-preview-dialog__footer">
          <div class="mobile-preview-dialog__zoom" aria-label="Масштаб предпросмотра">
            <button type="button" :disabled="previewZoom <= 0.5" aria-label="Уменьшить масштаб" @click="setPreviewZoom(previewZoom - 0.25)">
              <svg class="icon"><use href="#i-zoom-out" /></svg>
            </button>
            <output>{{ previewZoomPercent }}%</output>
            <button type="button" :disabled="previewZoom >= 3" aria-label="Увеличить масштаб" @click="setPreviewZoom(previewZoom + 0.25)">
              <svg class="icon"><use href="#i-zoom-in" /></svg>
            </button>
          </div>

          <button class="mobile-preview-dialog__expand" type="button" aria-label="Переключить полноэкранный режим" @click="toggleMobilePreviewFullscreen">
            <svg class="icon"><use href="#i-expand" /></svg>
          </button>

          <span class="mobile-preview-dialog__page-count">Стр. {{ currentPreviewIsImage ? 1 : previewPage }} из {{ currentPreviewIsImage ? 1 : currentPreviewPageCount }}</span>

          <div class="mobile-preview-dialog__page-nav" aria-label="Переключение страниц">
            <button type="button" :disabled="currentPreviewIsImage || previewPage <= 1" aria-label="Предыдущая страница" @click="navigatePage(-1)">
              <svg class="icon mobile-preview-dialog__chevron-up"><use href="#i-chevron" /></svg>
            </button>
            <button type="button" :disabled="currentPreviewIsImage || previewPage >= currentPreviewPageCount" aria-label="Следующая страница" @click="navigatePage(1)">
              <svg class="icon"><use href="#i-chevron" /></svg>
            </button>
          </div>
        </footer>
      </section>
    </Teleport>

    <div v-if="cropMode" class="crop-dialog-backdrop" @click.self="cancelCropping">
      <section
        ref="cropDialog"
        class="crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crop-dialog-title"
        aria-describedby="crop-dialog-description"
        tabindex="-1"
        @keydown.esc="cancelCropping"
      >
        <header class="crop-dialog__header">
          <h2 id="crop-dialog-title">Кадрирование изображения</h2>
          <p id="crop-dialog-description" class="visually-hidden">Выберите формат страницы и расположите документ в пределах рамки.</p>
          <button class="icon-button icon-button--alert-close" type="button" aria-label="Закрыть кадрирование" @click="cancelCropping">
            <svg class="icon"><use href="#i-close" /></svg>
          </button>
        </header>

        <div class="crop-dialog__content">
          <div class="crop-dialog__toolbar">
            <div class="crop-dialog__zoom" aria-label="Масштаб кадрирования">
              <button class="icon-button icon-button--preview" type="button" :disabled="cropZoom <= 1" aria-label="Уменьшить масштаб" @click="setCropZoom(cropZoom - 0.1)">
                <svg class="icon"><use href="#i-zoom-out" /></svg>
              </button>
              <output>{{ Math.round(cropZoom * 100) }}%</output>
              <button class="icon-button icon-button--preview" type="button" :disabled="cropZoom >= 3" aria-label="Увеличить масштаб" @click="setCropZoom(cropZoom + 0.1)">
                <svg class="icon"><use href="#i-zoom-in" /></svg>
              </button>
            </div>
            <button class="icon-button crop-dialog__reset" type="button" aria-label="Сбросить положение и масштаб" @click="changeCropFormat">
              <svg class="icon"><use href="#i-refresh" /></svg>
            </button>

            <label class="crop-dialog__format" for="crop-format">
              <span>Формат изображения:</span>
              <select id="crop-format" v-model="cropFormat" @change="changeCropFormat">
                <option value="a4-portrait">A4-книжная</option>
                <option value="a4-landscape">A4-альбомная</option>
                <option value="original">Исходные пропорции</option>
                <option value="free">Свободный формат</option>
              </select>
            </label>
          </div>

          <div class="crop-dialog__stage">
            <ReactEasyCrop
              :image="currentPreviewFile.previewUrl"
              v-model:crop="crop"
              v-model:zoom="cropZoom"
              :aspect="cropAspect"
              @crop-complete="cropPixels = $event"
            />
          </div>
        </div>

        <footer class="crop-dialog__actions">
          <button class="button button--primary" type="button" :disabled="!cropPixels" @click="applyCrop">Применить</button>
          <button class="button button--secondary" type="button" @click="cancelCropping">Отмена</button>
        </footer>
      </section>
    </div>

    <div
      v-if="filesPendingDeletion.length"
      class="confirm-dialog-backdrop"
      @click.self="cancelDeletion"
    >
      <section
        ref="deleteDialog"
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        tabindex="-1"
        @keydown.esc="cancelDeletion"
      >
        <div class="confirm-dialog__icon" aria-hidden="true"><svg class="icon"><use href="#i-trash" /></svg></div>
        <div class="confirm-dialog__content">
          <h2 id="delete-dialog-title">Удалить {{ filesPendingDeletion.length }} {{ fileWord(filesPendingDeletion.length) }}?</h2>
          <p id="delete-dialog-description">Файлы будут удалены из пакета.</p>
          <ul class="confirm-dialog__files" aria-label="Удаляемые файлы">
            <li v-for="file in filesPendingDeletion" :key="file.id">
              <span>{{ file.name }}</span>
              <small>{{ formatSize(file.size) }} МБ</small>
            </li>
          </ul>
        </div>
        <div class="confirm-dialog__actions">
          <button class="button button--secondary" type="button" @click="cancelDeletion">Отмена</button>
          <button class="button button--danger" type="button" @click="confirmDeletion">
            <svg class="icon"><use href="#i-trash" /></svg>
            Удалить
          </button>
        </div>
      </section>
    </div>

    <aside
      v-if="uploadPanelVisible && statusDisplayMode === 'notification'"
      class="upload-notification"
      :class="{
        'upload-notification--error': !uploadingActivityCount && failedActivityCount,
        'upload-notification--success': !uploadingActivityCount && !failedActivityCount,
      }"
      role="region"
      aria-labelledby="upload-notification-title"
      :aria-live="uploadingActivityCount ? 'off' : 'polite'"
      aria-atomic="true"
    >
      <span class="upload-notification__state" aria-hidden="true">
        <span v-if="uploadingActivityCount" class="upload-activity__spinner upload-notification__spinner" />
        <svg v-else-if="failedActivityCount" class="icon upload-notification__status upload-notification__status--error"><use href="#i-error-circle" /></svg>
        <svg v-else class="icon upload-notification__status upload-notification__status--success"><use href="#i-check-circle" /></svg>
      </span>

      <div class="upload-notification__content">
        <strong id="upload-notification-title">Добавление файлов</strong>
        <span>{{ uploadPanelSummary }}</span>
        <div v-if="uploadingActivityCount" class="upload-notification__progress" aria-hidden="true">
          <span :style="{ width: activityOverallProgress + '%' }" />
        </div>
      </div>

      <button class="icon-button icon-button--quiet upload-notification__close" type="button" aria-label="Закрыть уведомление о добавлении файлов" @click="closeUploadPanel">
        <svg class="icon"><use href="#i-close" /></svg>
      </button>
    </aside>

    <div
      v-if="uploadPanelVisible && statusDisplayMode === 'popover'"
      class="upload-bottom-sheet-backdrop"
      aria-hidden="true"
      @click="!uploadingActivityCount && closeUploadPanel()"
    />

    <aside
      v-if="uploadPanelVisible && statusDisplayMode === 'popover'"
      class="upload-popover upload-bottom-sheet"
      :class="{ 'upload-popover--collapsed': !uploadPanelExpanded }"
      role="region"
      aria-labelledby="upload-popover-title"
    >
      <div class="upload-bottom-sheet__handle" aria-hidden="true" />
      <header class="upload-popover__header">
        <div class="upload-popover__heading">
          <button
            class="upload-popover__title-button"
            type="button"
            :aria-expanded="uploadPanelExpanded"
            aria-controls="upload-popover-body"
            :aria-label="uploadPanelExpanded ? 'Свернуть статус добавления файлов' : 'Развернуть статус добавления файлов'"
            @click="!uploadingActivityCount && (uploadPanelExpanded = !uploadPanelExpanded)"
          >
            <h2 id="upload-popover-title">{{ uploadPopoverTitle }}</h2>
          </button>
          <div class="upload-popover__actions">
            <button
              v-if="!uploadPanelExpanded"
              class="upload-popover__icon-button"
              type="button"
              aria-label="Развернуть статус добавления файлов"
              @click="uploadPanelExpanded = true"
            >
              <svg class="icon"><use href="#i-chevron" /></svg>
            </button>
            <button v-if="!uploadingActivityCount" class="upload-popover__icon-button" type="button" aria-label="Закрыть статус загрузки" @click="closeUploadPanel">
              <svg class="icon"><use href="#i-close" /></svg>
            </button>
          </div>
        </div>
        <p
          v-if="uploadPanelExpanded && uploadPopoverDescription"
          class="upload-popover__description"
          :aria-live="uploadingActivityCount ? 'off' : 'polite'"
          aria-atomic="true"
        >
          <span>{{ uploadPopoverDescription }}</span>
        </p>
        <div v-if="uploadingActivityCount" class="upload-popover__overall-progress" role="progressbar" :aria-valuenow="activityOverallProgress" aria-valuemin="0" aria-valuemax="100" aria-label="Общий прогресс загрузки">
          <span :style="{ width: activityOverallProgress + '%' }" />
        </div>
      </header>

      <div v-if="uploadPanelExpanded" id="upload-popover-body" class="upload-popover__body">
        <ul class="upload-activity-list">
          <li v-for="activity in uploadPopoverActivities" :key="activity.id" class="upload-activity" :class="'upload-activity--' + activity.status">
            <div class="upload-activity__content">
              <strong :title="activity.name">{{ activity.name }}</strong>
              <span v-if="activity.status === 'error'" :title="activity.reason">{{ activity.reason }}</span>
            </div>

            <div class="upload-activity__meta">
              <span>{{ formatSize(activity.size) }} МБ</span>
              <span v-if="activity.status === 'uploading'" class="upload-activity__percent">{{ activity.progress }}%</span>
              <span v-if="activity.status === 'uploading'" class="upload-activity__spinner" role="progressbar" :aria-valuenow="activity.progress" aria-valuemin="0" aria-valuemax="100" :aria-label="'Загрузка ' + activity.name" />
              <svg v-else-if="activity.status === 'success'" class="icon upload-activity__status upload-activity__status--success" aria-label="Загружен"><use href="#i-check-circle" /></svg>
              <svg v-else class="icon upload-activity__status upload-activity__status--error" aria-label="Ошибка"><use href="#i-error-circle" /></svg>
            </div>
          </li>
        </ul>
      </div>
    </aside>

    <div class="visually-hidden" aria-live="polite" aria-atomic="true">{{ statusMessage }}</div>

    <div v-if="packageSent" class="toast" :class="{ 'toast--with-upload-popover': uploadPanelVisible }" role="status">
      <span class="toast__icon"><svg class="icon"><use href="#i-check" /></svg></span>
      <div><strong>Пакет готов к отправке</strong><span>{{ uploadedCount }} {{ fileWord(uploadedCount) }} прошли загрузку.</span></div>
      <button class="icon-button icon-button--quiet" type="button" aria-label="Закрыть уведомление" @click="packageSent = false"><svg class="icon"><use href="#i-close" /></svg></button>
    </div>
  </div>
</template>
