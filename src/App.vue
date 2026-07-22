<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { BaseUiButton as DnsButton, BaseUiIconButton as DnsIconButton } from '@dns-modules/base-ui-button'
import { BaseLink as DnsLink } from '@dns-modules/base-link'
import { Tab as DnsTab, TabList as DnsTabList } from '@dns-modules/base-ui-tabs'
import { Checkbox as DnsCheckbox } from '@dns-modules/checkbox'
import { ListRow as DnsListRow } from '@dns-modules/list-row'
import { BottomSheet as DnsBottomSheet } from '@dns-modules/bottom-sheet'
import { FlatMenuList as DnsFlatMenu, MenuItem as DnsMenuItem } from '@dns-modules/menu'
import { Modal as DnsModal } from '@dns-modules/modal'
import { Popover as DnsPopover } from '@dns-modules/popover'
import { RadioOption as DnsRadioOption, SelectInline as DnsSelectInline } from '@dns-modules/select-inline'
import { Snackbar as DnsSnackbar } from '@dns-modules/snackbar'
import { Stepper as DnsStepper } from '@dns-modules/stepper'
import DnsToggle from '@dns-modules/toggle'
import emptyStateImage from './assets/Empty states.png'

const ReactEasyCrop = defineAsyncComponent(() => import('./components/ReactEasyCrop.vue'))
const PdfPreview = defineAsyncComponent(() => import('./components/PdfPreview.vue'))

const MB = 1024 * 1024
const MAX_FILE_SIZE = 20 * MB
const REORDER_HOLD_DELAY = 800
const REORDER_MOVE_THRESHOLD = 8
const allowedExtensions = ['pdf', 'jpg', 'jpeg', 'png']
const currentPath = window.location.pathname.replace(/\/+$/, '') || '/'
const statusDisplayMode = currentPath === '/notification' ? 'notification' : 'popover'
const mobileViewportQuery = window.matchMedia('(max-width: 600px)')
const navigationTabs = [
  { id: 'upload', label: 'Загрузка документов' },
  { id: 'drafts', label: 'Черновики' },
  { id: 'statuses', label: 'Статусы документооборота' },
]

let nextId = 20
let tableDragDepth = 0
const timers = new Map()
let mobileListResizeObserver = null
let mobileListScrollFrame = 0
let reorderScrollContainer = null
let reorderOriginalFiles = null
let reorderPreviewedFileId = null
let reorderOriginalDraftSaved = false
let reorderHoldTimer = null
let reorderPointerTarget = null
let reorderOriginalOverflow = ''
let reorderOverlayElement = null
let reorderOverlayOrigin = null
let reorderMoveFrame = 0
let reorderMovePoint = null
const reorderItemAnimations = new Map()

const fileInput = ref(null)
const errorSummary = ref(null)
const packageTitle = ref(null)
const uploadPopoverAnchor = ref(null)
const desktopPreviewSelectAnchor = ref(null)
const deletionPopoverAnchor = ref(null)
const dragActive = ref(false)
const previewEnabled = ref(false)
const previewIndex = ref(0)
const previewSelectOpen = ref(false)
const previewPage = ref(1)
const previewZoom = ref(1)
const previewZoomStepperValue = ref(100)
const previewPan = ref({ x: 0, y: 0 })
const previewPointer = ref(null)
const cropMode = ref(false)
const crop = ref({ x: 0, y: 0 })
const cropZoom = ref(1)
const cropZoomStepperValue = ref(100)
const cropRotation = ref(0)
const cropPixels = ref(null)
const cropFormat = ref('original')
const cropFormatSelectOpen = ref(false)
const cropImageRatio = ref(1)
const pdfPageCounts = ref({})
const previewError = ref('')
const selectedIds = ref([])
const statusMessage = ref('')
const draftSaved = ref(false)
const packageSent = ref(false)
const activeNavigationTab = ref('upload')
const mobileMenuOpen = ref(false)
const mobileActionsMenuOpen = ref(false)
const mobileActionsTrigger = ref(null)
const mobilePreviewOpen = ref(false)
const mobilePreviewDialog = ref(null)
const previewFileSearch = ref('')
const mobileFileListItems = ref(null)
const mobileListScroll = reactive({
  visible: false,
  thumbHeight: 0,
  thumbOffset: 0,
})
const reorderDrag = reactive({
  fileId: null,
  pointerId: null,
  startX: 0,
  startY: 0,
  pending: false,
  active: false,
  settling: false,
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
const pendingClearPackage = ref(false)
const isMobileViewport = ref(mobileViewportQuery.matches)

const cropFormatDefinitions = [
  { id: 'a4-portrait', title: 'A4-книжная' },
  { id: 'a4-landscape', title: 'A4-альбомная' },
  { id: 'original', title: 'Исходные пропорции' },
  { id: 'free', title: 'Свободный формат' },
]

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
  if (uploadingActivityCount.value) {
    const count = uploadActivities.value.length
    return (fileWord(count) === 'файл' ? 'Добавляется ' : 'Добавляются ') + count + ' ' + fileWord(count)
  }

  const count = successActivityCount.value
  return (fileWord(count) === 'файл' ? 'Добавлен ' : 'Добавлено ') + count + ' ' + fileWord(count)
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
const deletionConfirmationVisible = computed(() => pendingClearPackage.value || filesPendingDeletion.value.length > 0)
const singleFilePendingDeletion = computed(() => (
  !pendingClearPackage.value && filesPendingDeletion.value.length === 1
    ? filesPendingDeletion.value[0]
    : null
))
const deletionConfirmationTitle = computed(() => {
  if (pendingClearPackage.value) return 'Очистить пакет?'
  return 'Удалить ' + filesPendingDeletion.value.length + ' ' + fileWord(filesPendingDeletion.value.length) + '?'
})
const deletionConfirmationDescription = computed(() => pendingClearPackage.value
  ? 'Все файлы будут удалены.'
  : 'Выбранные файлы будут удалены из пакета.')

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

function toggleFileSelection(fileId) {
  selectedIds.value = selectedIdSet.value.has(fileId)
    ? selectedIds.value.filter((id) => id !== fileId)
    : [...selectedIds.value, fileId]
}

function toggleAllSelection() {
  allSelected.value = !allSelected.value
}

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
const previewFileOptions = computed(() => uploadedFiles.value.map((file, index) => ({
  id: String(index),
  title: file.name,
  isSelected: index === currentPreviewIndex.value,
})))
const filteredPreviewFileOptions = computed(() => {
  const query = previewFileSearch.value.trim().toLocaleLowerCase('ru-RU')
  if (!query) return previewFileOptions.value
  return previewFileOptions.value.filter((option) => option.title.toLocaleLowerCase('ru-RU').includes(query))
})
const mobileActionsReference = computed(() => mobileActionsTrigger.value)
const currentPreviewIsImage = computed(() => currentPreviewFile.value?.type?.startsWith('image/'))
const currentPreviewPageCount = computed(() => {
  const renderedPages = pdfPageCounts.value[currentPreviewFile.value?.id]
  if (renderedPages) return renderedPages
  const pages = Number(currentPreviewFile.value?.pages)
  return Number.isFinite(pages) && pages > 0 ? pages : 1
})
const previewZoomPercent = computed(() => Math.round(previewZoom.value * 100))
const previewZoomStepperLabel = computed(() => previewZoomStepperValue.value === '' ? '' : `${previewZoomStepperValue.value}%`)
const cropZoomStepperLabel = computed(() => cropZoomStepperValue.value === '' ? '' : `${cropZoomStepperValue.value}%`)
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
const cropFormatOptions = computed(() => cropFormatDefinitions.map((option) => ({
  ...option,
  isSelected: option.id === cropFormat.value,
})))
const cropFormatTitle = computed(() => cropFormatDefinitions.find((option) => option.id === cropFormat.value)?.title || '')

function syncMobileViewport(event) {
  isMobileViewport.value = event.matches
}

mobileViewportQuery.addEventListener('change', syncMobileViewport)

watch(currentPreviewFile, () => resetPreviewView())
watch(previewZoom, (value) => {
  const percent = Math.round(value * 100)
  if (Number(previewZoomStepperValue.value) !== percent) previewZoomStepperValue.value = percent
})
watch(previewZoomStepperValue, (value) => {
  if (value === '') return
  const percent = Number(value)
  if (!Number.isFinite(percent)) return
  if (percent >= 50 && percent <= 300) {
    setPreviewZoom(percent / 100)
  }
})
watch(cropZoom, (value) => {
  const percent = Math.round(value * 100)
  if (Number(cropZoomStepperValue.value) !== percent) cropZoomStepperValue.value = percent
})
watch(cropZoomStepperValue, (value) => {
  if (value === '') return
  const percent = Number(value)
  if (!Number.isFinite(percent)) return
  if (percent >= 100 && percent <= 300) {
    setCropZoom(percent / 100)
  }
})
watch(previewSelectOpen, (isOpen) => {
  if (!isOpen) previewFileSearch.value = ''
})
watch(mobileActionsMenuOpen, (isOpen) => {
  if (isOpen) nextTick(() => document.querySelector('#mobile-actions-sheet [role="menuitem"]')?.focus())
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
  cropRotation.value = 0
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
  if (!currentPreviewIsImage.value || cropMode.value || previewZoom.value <= 1) return
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
  cropRotation.value = 0
  cropPixels.value = null
  cropFormat.value = 'original'
  cropFormatSelectOpen.value = false
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
  nextTick(() => document.querySelector('.crop-dialog')?.focus())
}

function cancelCropping() {
  cropMode.value = false
  cropRotation.value = 0
  cropPixels.value = null
  cropFormatSelectOpen.value = false
}

function changeCropFormat() {
  crop.value = { x: 0, y: 0 }
  cropZoom.value = 1
  cropRotation.value = 0
  cropPixels.value = null
}

function selectCropFormat(id) {
  cropFormat.value = id
  cropFormatSelectOpen.value = false
  changeCropFormat()
}

function setCropZoom(nextZoom) {
  cropZoom.value = Math.min(3, Math.max(1, Number(nextZoom)))
}

function rotateCrop(direction) {
  cropRotation.value = (cropRotation.value + direction + 360) % 360
  crop.value = { x: 0, y: 0 }
  cropPixels.value = null
}

function applyCrop() {
  const file = currentPreviewFile.value
  const area = cropPixels.value
  if (!file?.previewUrl || !area) return cancelCropping()

  const image = new Image()
  image.onload = () => {
    const radians = cropRotation.value * Math.PI / 180
    const sin = Math.abs(Math.sin(radians))
    const cos = Math.abs(Math.cos(radians))
    const rotatedWidth = Math.round(image.naturalWidth * cos + image.naturalHeight * sin)
    const rotatedHeight = Math.round(image.naturalWidth * sin + image.naturalHeight * cos)
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = rotatedWidth
    sourceCanvas.height = rotatedHeight
    const sourceContext = sourceCanvas.getContext('2d')
    sourceContext.translate(rotatedWidth / 2, rotatedHeight / 2)
    sourceContext.rotate(radians)
    sourceContext.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(area.width)
    canvas.height = Math.round(area.height)
    const context = canvas.getContext('2d')
    context.drawImage(sourceCanvas, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) return
      if (file.previewUrl.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl)
      file.previewUrl = URL.createObjectURL(blob)
      cropMode.value = false
      cropRotation.value = 0
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

function setPreviewEnabled(event) {
  previewEnabled.value = event.target.checked
}

function selectPreviewFile(id) {
  previewIndex.value = Number(id)
  previewSelectOpen.value = false
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

function closeMobilePreview() {
  mobilePreviewOpen.value = false
  previewSelectOpen.value = false
  announce('Предпросмотр файлов закрыт.')
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
  requestClearPackage(mobileActionsReference.value)
}

function showUploadPanel(expand = true) {
  uploadPanelDismissed.value = false
  if (expand) uploadPanelExpanded.value = true
}

function closeUploadPanel() {
  uploadPanelDismissed.value = true
}

function closeDesktopUploadPanel() {
  if (!isMobileViewport.value) closeUploadPanel()
}

function closeMobileUploadPanel() {
  if (isMobileViewport.value) closeUploadPanel()
}

async function goToPackage(closeSurface) {
  if (closeSurface) await closeSurface()
  else closeUploadPanel()
  packageSent.value = false
  await nextTick()
  packageTitle.value?.focus()
}

async function addMoreFiles(closeSurface) {
  if (closeSurface) await closeSurface()
  else closeUploadPanel()
  await nextTick()
  openFilePicker()
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

function resolveDeletionAnchor(source) {
  const element = source?.currentTarget ?? source?.$el ?? source
  return element instanceof HTMLElement ? element : null
}

function focusDeletionConfirmation() {
  nextTick(() => document.querySelector('.delete-confirm-sheet button, .delete-confirm-popover button')?.focus())
}

function deleteFile(id, event) {
  requestDeletion([id], event)
}

function deleteSelected(event) {
  if (!selectedIds.value.length) return
  requestDeletion(selectedIds.value, event)
}

function requestDeletion(ids, source) {
  const available = new Set(uploadedFiles.value.map((file) => file.id))
  pendingDeletionIds.value = ids.filter((id) => available.has(id))
  if (!pendingDeletionIds.value.length) return
  pendingClearPackage.value = false
  deletionPopoverAnchor.value = resolveDeletionAnchor(source)
  focusDeletionConfirmation()
}

function requestClearPackage(source) {
  if (!uploadedFiles.value.length && !failedFiles.value.length && !uploadQueue.value.length) return
  pendingDeletionIds.value = []
  pendingClearPackage.value = true
  deletionPopoverAnchor.value = resolveDeletionAnchor(source)
  focusDeletionConfirmation()
}

function cancelDeletion() {
  pendingDeletionIds.value = []
  pendingClearPackage.value = false
  deletionPopoverAnchor.value = null
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
  deletionPopoverAnchor.value = null
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

function reorderFileToIndex(fileId, targetIndex) {
  const next = [...uploadedFiles.value]
  const fromIndex = next.findIndex((file) => file.id === fileId)
  if (fromIndex < 0) return false

  const finalIndex = Math.min(Math.max(targetIndex, 0), next.length - 1)
  if (fromIndex === finalIndex) return false

  const previewedFileId = currentPreviewFile.value?.id
  const [movedFile] = next.splice(fromIndex, 1)
  next.splice(finalIndex, 0, movedFile)
  uploadedFiles.value = next

  if (previewedFileId) previewIndex.value = next.findIndex((file) => file.id === previewedFileId)
  draftSaved.value = false
  nextTick(scheduleMobileListScrollbarUpdate)
  return true
}

function prefersReducedReorderMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function clearReorderItemAnimations() {
  reorderItemAnimations.forEach((animation) => animation.cancel())
  reorderItemAnimations.clear()
}

function captureReorderItemPositions() {
  const positions = new Map()
  reorderScrollContainer?.querySelectorAll('[data-reorder-file-id]').forEach((element) => {
    positions.set(element.dataset.reorderFileId, element.getBoundingClientRect())
  })
  return positions
}

function animateReorderItemPositions(firstPositions) {
  nextTick(() => {
    const elements = [...(reorderScrollContainer?.querySelectorAll('[data-reorder-file-id]') ?? [])]
    clearReorderItemAnimations()
    const lastPositions = new Map(elements.map((element) => [element, element.getBoundingClientRect()]))
    if (reorderDrag.settling || prefersReducedReorderMotion()) return

    elements.forEach((element) => {
      if (Number(element.dataset.reorderFileId) === reorderDrag.fileId) return
      const first = firstPositions.get(element.dataset.reorderFileId)
      const last = lastPositions.get(element)
      if (!first || !last) return

      const deltaY = first.top - last.top
      if (Math.abs(deltaY) < 0.5) return

      const animation = element.animate([
        { transform: `translate3d(0, ${deltaY}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' },
      ], {
        duration: 200,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      })
      reorderItemAnimations.set(element, animation)
      animation.addEventListener('finish', () => reorderItemAnimations.delete(element), { once: true })
      animation.addEventListener('cancel', () => reorderItemAnimations.delete(element), { once: true })
    })
  })
}

function sanitizeReorderClone(clone) {
  clone.classList.remove(
    'files-table__row--holding',
    'files-table__row--dragging',
    'mobile-file-list__item--holding',
    'mobile-file-list__item--dragging',
  )
  clone.removeAttribute('data-reorder-file-id')
  clone.removeAttribute('data-file-id')
  clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))
  clone.querySelectorAll('button, input, select, textarea, a, [tabindex]').forEach((element) => {
    element.setAttribute('tabindex', '-1')
  })
}

function createFileReorderOverlay(sourceElement) {
  removeFileReorderOverlay()
  if (!(sourceElement instanceof HTMLElement)) return

  const rect = sourceElement.getBoundingClientRect()
  const root = document.createElement('div')
  root.className = 'file-reorder-overlay'
  root.setAttribute('aria-hidden', 'true')
  root.style.left = `${rect.left}px`
  root.style.top = `${rect.top}px`
  root.style.width = `${rect.width}px`
  root.style.height = `${rect.height}px`
  root.style.setProperty('--reorder-x', '0px')
  root.style.setProperty('--reorder-y', '0px')

  const clone = sourceElement.cloneNode(true)
  sanitizeReorderClone(clone)

  if (sourceElement.tagName === 'TR') {
    root.classList.add('file-reorder-overlay--table')
    const table = document.createElement('table')
    const body = document.createElement('tbody')
    table.className = 'files-table file-reorder-overlay__surface file-reorder-overlay__surface--table'
    table.style.width = `${rect.width}px`
    table.style.height = `${rect.height}px`
    Array.from(sourceElement.children).forEach((cell, index) => {
      const width = cell.getBoundingClientRect().width
      const clonedCell = clone.children[index]
      if (!clonedCell) return
      clonedCell.style.width = `${width}px`
      clonedCell.style.minWidth = `${width}px`
      clonedCell.style.maxWidth = `${width}px`
    })
    body.append(clone)
    table.append(body)
    root.append(table)
  } else {
    root.classList.add('file-reorder-overlay--mobile')
    const list = document.createElement('ul')
    list.className = 'mobile-file-list__items file-reorder-overlay__surface file-reorder-overlay__surface--mobile'
    list.style.width = `${rect.width}px`
    list.style.height = `${rect.height}px`
    clone.style.width = `${rect.width}px`
    clone.style.height = `${rect.height}px`
    list.append(clone)
    root.append(list)
  }

  document.body.append(root)
  document.body.classList.add('file-reorder-active')
  reorderOverlayElement = root
  reorderOverlayOrigin = { left: rect.left, top: rect.top }
  root.getBoundingClientRect()
  window.requestAnimationFrame(() => root.classList.add('file-reorder-overlay--picked'))
}

function moveFileReorderOverlay(clientX, clientY) {
  if (!reorderOverlayElement) return
  reorderOverlayElement.style.setProperty('--reorder-x', `${clientX - reorderDrag.startX}px`)
  reorderOverlayElement.style.setProperty('--reorder-y', `${clientY - reorderDrag.startY}px`)
}

function removeFileReorderOverlay() {
  reorderOverlayElement?.remove()
  reorderOverlayElement = null
  reorderOverlayOrigin = null
  document.body.classList.remove('file-reorder-active')
}

function settleFileReorderOverlay(fileId, complete) {
  nextTick(() => {
    const overlay = reorderOverlayElement
    const target = reorderScrollContainer?.querySelector(`[data-reorder-file-id="${fileId}"]`)
    if (!overlay || !target || !reorderOverlayOrigin || prefersReducedReorderMotion()) {
      removeFileReorderOverlay()
      complete()
      return
    }

    const targetRect = target.getBoundingClientRect()
    let completed = false
    const finish = () => {
      if (completed) return
      completed = true
      removeFileReorderOverlay()
      complete()
    }

    overlay.classList.add('file-reorder-overlay--settling')
    overlay.addEventListener('transitionend', (event) => {
      if (event.target === overlay && event.propertyName === 'transform') finish()
    })
    window.setTimeout(finish, 260)
    window.requestAnimationFrame(() => {
      overlay.style.setProperty('--reorder-x', `${targetRect.left - reorderOverlayOrigin.left}px`)
      overlay.style.setProperty('--reorder-y', `${targetRect.top - reorderOverlayOrigin.top}px`)
    })
  })
}

function resetPendingFileReorder() {
  if (reorderHoldTimer) window.clearTimeout(reorderHoldTimer)
  reorderHoldTimer = null
  reorderDrag.pending = false
}

function preventTouchScrollDuringReorder(event) {
  if (reorderDrag.active) event.preventDefault()
}

function beginFileReorder(event, fileId) {
  if (reorderDrag.settling || isUploading.value || uploadedFiles.value.length < 2) return
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
  if (event.target.closest('button, input, label, a, select, textarea')) return

  resetPendingFileReorder()
  reorderDrag.fileId = fileId
  reorderDrag.pointerId = event.pointerId
  reorderDrag.startX = event.clientX
  reorderDrag.startY = event.clientY
  reorderDrag.pending = true
  reorderDrag.active = false
  reorderDrag.settling = false
  reorderPointerTarget = event.currentTarget
  reorderScrollContainer = event.currentTarget.closest('.mobile-file-list__items, .files-table-wrap')

  reorderHoldTimer = window.setTimeout(() => {
    if (!reorderDrag.pending || reorderDrag.pointerId !== event.pointerId) return

    createFileReorderOverlay(reorderPointerTarget)
    reorderDrag.pending = false
    reorderDrag.active = true
    reorderOriginalFiles = [...uploadedFiles.value]
    reorderPreviewedFileId = currentPreviewFile.value?.id ?? null
    reorderOriginalDraftSaved = draftSaved.value
    reorderPointerTarget?.setPointerCapture?.(event.pointerId)

    if (reorderScrollContainer) {
      reorderOriginalOverflow = reorderScrollContainer.style.overflowY
      reorderScrollContainer.style.overflowY = 'hidden'
    }
    window.addEventListener('touchmove', preventTouchScrollDuringReorder, { passive: false })
    navigator.vibrate?.(20)
  }, REORDER_HOLD_DELAY)
}

function autoScrollReorderList(clientY) {
  const container = reorderScrollContainer
  if (!container || container.scrollHeight <= container.clientHeight) return

  const rect = container.getBoundingClientRect()
  const edge = Math.min(56, rect.height / 4)
  if (clientY < rect.top + edge) container.scrollTop -= 12
  else if (clientY > rect.bottom - edge) container.scrollTop += 12
}

function processFileReorderMove() {
  reorderMoveFrame = 0
  const point = reorderMovePoint
  if (!point || !reorderDrag.active || reorderDrag.settling || reorderDrag.fileId == null) return

  moveFileReorderOverlay(point.clientX, point.clientY)
  autoScrollReorderList(point.clientY)

  const targetRow = document.elementFromPoint(point.clientX, point.clientY)?.closest('[data-reorder-file-id]')
  if (!targetRow || !reorderScrollContainer?.contains(targetRow)) return

  const targetId = Number(targetRow.dataset.reorderFileId)
  const fromIndex = uploadedFiles.value.findIndex((file) => file.id === reorderDrag.fileId)
  const targetIndex = uploadedFiles.value.findIndex((file) => file.id === targetId)
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return

  const targetRect = targetRow.getBoundingClientRect()
  const insertBefore = point.clientY < targetRect.top + targetRect.height / 2
  let finalIndex = targetIndex
  if (insertBefore && fromIndex < targetIndex) finalIndex -= 1
  if (!insertBefore && fromIndex > targetIndex) finalIndex += 1

  const firstPositions = captureReorderItemPositions()
  if (reorderFileToIndex(reorderDrag.fileId, finalIndex)) {
    animateReorderItemPositions(firstPositions)
  }
}

function moveFileReorder(event) {
  if (event.pointerId !== reorderDrag.pointerId || reorderDrag.fileId == null) return

  const distance = Math.hypot(event.clientX - reorderDrag.startX, event.clientY - reorderDrag.startY)
  if (!reorderDrag.active) {
    if (distance > REORDER_MOVE_THRESHOLD) {
      resetPendingFileReorder()
      reorderDrag.fileId = null
      reorderDrag.pointerId = null
      reorderPointerTarget = null
      reorderScrollContainer = null
    }
    return
  }

  event.preventDefault()
  reorderMovePoint = { clientX: event.clientX, clientY: event.clientY }
  if (!reorderMoveFrame) reorderMoveFrame = window.requestAnimationFrame(processFileReorderMove)
}

function finishFileReorder(event, cancelled = false) {
  if (event.pointerId !== reorderDrag.pointerId) return

  resetPendingFileReorder()
  if (reorderPointerTarget?.hasPointerCapture?.(event.pointerId)) {
    reorderPointerTarget.releasePointerCapture(event.pointerId)
  }
  if (reorderScrollContainer) reorderScrollContainer.style.overflowY = reorderOriginalOverflow
  window.removeEventListener('touchmove', preventTouchScrollDuringReorder)
  if (reorderMoveFrame) window.cancelAnimationFrame(reorderMoveFrame)
  reorderMoveFrame = 0
  reorderMovePoint = null

  const wasActive = reorderDrag.active
  const draggedId = reorderDrag.fileId

  if (cancelled && wasActive && reorderOriginalFiles) {
    uploadedFiles.value = reorderOriginalFiles
    draftSaved.value = reorderOriginalDraftSaved
    if (reorderPreviewedFileId) {
      previewIndex.value = uploadedFiles.value.findIndex((file) => file.id === reorderPreviewedFileId)
    }
  }

  reorderDrag.pointerId = null
  reorderDrag.pending = false
  reorderPointerTarget = null

  if (!wasActive) {
    reorderDrag.fileId = null
    reorderDrag.active = false
    reorderDrag.settling = false
    reorderScrollContainer = null
    reorderOriginalOverflow = ''
    return
  }

  reorderDrag.settling = true
  settleFileReorderOverlay(draggedId, () => {
    clearReorderItemAnimations()
    reorderDrag.fileId = null
    reorderDrag.active = false
    reorderDrag.settling = false
    reorderScrollContainer = null
    reorderOriginalOverflow = ''
    reorderOriginalFiles = null
    reorderPreviewedFileId = null
    reorderOriginalDraftSaved = false

    if (cancelled) {
      announce('Изменение порядка файлов отменено.')
      return
    }

    const file = uploadedFiles.value.find((item) => item.id === draggedId)
    const position = uploadedFiles.value.findIndex((item) => item.id === draggedId) + 1
    if (!file || position < 1) return
    announce(`Файл ${file.name} перемещён на позицию ${position} из ${uploadedFiles.value.length}.`)
    scheduleMobileListScrollbarUpdate()
  })
}

function preventFileReorderContextMenu(event) {
  if (reorderDrag.pending || reorderDrag.active || reorderDrag.settling) event.preventDefault()
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

function performClearPackage() {
  if (!uploadedFiles.value.length && !failedFiles.value.length && !uploadQueue.value.length) return
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

function confirmDestructiveAction() {
  if (pendingClearPackage.value) {
    pendingClearPackage.value = false
    deletionPopoverAnchor.value = null
    performClearPackage()
    return
  }

  confirmDeletion()
}

function saveDraft() {
  draftSaved.value = true
  announce('Черновик сохранён. Состояние загрузки зафиксировано.')
}

function sendPackage() {
  if (!canSend.value) {
    return
  }
  closeUploadPanel()
  uploadedFiles.value.forEach((file) => {
    if (file.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl)
  })
  uploadedFiles.value = []
  selectedIds.value = []
  previewIndex.value = 0
  previewEnabled.value = false
  draftSaved.value = false
  uploadActivities.value = []
  packageSent.value = true
  announce('Пакет успешно отправлен.')
}

onBeforeUnmount(() => {
  timers.forEach((timer) => window.clearInterval(timer))
  if (reorderHoldTimer) window.clearTimeout(reorderHoldTimer)
  if (reorderMoveFrame) window.cancelAnimationFrame(reorderMoveFrame)
  clearReorderItemAnimations()
  removeFileReorderOverlay()
  mobileViewportQuery.removeEventListener('change', syncMobileViewport)
  window.removeEventListener('touchmove', preventTouchScrollDuringReorder)
  if (reorderScrollContainer) reorderScrollContainer.style.overflowY = reorderOriginalOverflow
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
      <symbol id="i-rotate-left" viewBox="0 0 24 24"><path d="M4 8V3M4 3h5M4.5 8A8 8 0 1 1 4 14" /></symbol>
      <symbol id="i-rotate-right" viewBox="0 0 24 24"><path d="M20 8V3M20 3h-5M19.5 8A8 8 0 1 0 20 14" /></symbol>
      <symbol id="i-save" viewBox="0 0 24 24"><path d="M4 4h13l3 3v13H4zM8 4v6h8V4M8 20v-6h8v6" /></symbol>
      <symbol id="i-send" viewBox="0 0 24 24"><path d="m3 4 18 8-18 8 3-8zM6 12h15" /></symbol>
      <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></symbol>
      <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></symbol>
      <symbol id="i-warning" viewBox="0 0 24 24"><path d="M12 3 2.5 20h19zM12 9v5M12 17.5v.5" /></symbol>
      <symbol id="i-zoom-in" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4M10.5 7.5v6M7.5 10.5h6" /></symbol>
      <symbol id="i-zoom-out" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4M7.5 10.5h6" /></symbol>
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
          <DnsTabList :tabs="navigationTabs" class="main-nav__list">
            <template #default="tab">
              <DnsTab
                class="main-nav__item"
                :class="{ 'main-nav__item--active': activeNavigationTab === tab.id }"
                :is-active="activeNavigationTab === tab.id"
                @click="activeNavigationTab = tab.id"
              >
                {{ tab.label }}
              </DnsTab>
            </template>
          </DnsTabList>
        </nav>
      </div>

      <div v-if="!isMobileViewport" class="user-area">
        <DnsLink class="help-link" tag="a" href="#upload-help">Помощь</DnsLink>
        <DnsIconButton class="logout-button" variant="secondary" size="medium" type="button" aria-label="Выйти">
          <svg class="icon"><use href="#i-logout" /></svg>
        </DnsIconButton>
      </div>
      <template v-else>
        <DnsLink class="mobile-header-help" tag="a" href="#upload-help">Помощь</DnsLink>
        <DnsIconButton class="mobile-menu-button" variant="secondary" size="medium" type="button" aria-label="Выйти">
          <svg class="icon"><use href="#i-logout" /></svg>
        </DnsIconButton>
      </template>
    </header>

    <main class="page">
      <section class="package-card" :class="{ 'package-card--empty': !uploadedFiles.length }" aria-labelledby="package-title">
        <header class="package-header">
          <div class="package-title-group">
            <h1 id="package-title" ref="packageTitle" tabindex="-1">Пакет документов <span class="package-file-count">({{ uploadedCount }})</span></h1>
            <span
              v-if="uploadedFiles.length && isMobileViewport"
              ref="mobileActionsTrigger"
              class="mobile-package-actions-anchor"
            >
              <DnsIconButton
                class="icon-button mobile-package-actions-trigger"
                variant="tertiary"
                size="small"
                type="button"
                aria-label="Дополнительные действия с пакетом"
                aria-haspopup="menu"
                aria-controls="mobile-actions-sheet"
                :aria-expanded="mobileActionsMenuOpen"
                @click.stop="mobileActionsMenuOpen = !mobileActionsMenuOpen"
              >
                <svg class="icon"><use href="#i-more" /></svg>
              </DnsIconButton>
            </span>
          </div>

          <div class="package-actions">
            <div class="package-actions__buttons">
              <DnsToggle
                class="preview-toggle"
                :checked="previewEnabled"
                :disabled="!uploadedFiles.length"
                aria-label="Предпросмотр файлов"
                @click="setPreviewEnabled"
              >
                <template #right-label>Предпросмотр файлов</template>
              </DnsToggle>

              <DnsButton class="button button--secondary" variant="secondary" type="button" :disabled="!uploadedFiles.length" @click="saveDraft">
                <template #icon-left><svg class="icon"><use href="#i-save" /></svg></template>
                {{ draftSaved ? 'Черновик сохранён' : 'Сохранить черновик' }}
              </DnsButton>

              <DnsButton class="button button--primary" variant="primary" type="button" :disabled="!canSend" @click="sendPackage">
                <template #icon-left><svg class="icon"><use href="#i-send" /></svg></template>
                Отправить пакет
              </DnsButton>
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
          <div v-if="uploadedFiles.length" class="toolbar">
            <div class="toolbar__selection" aria-label="Действия с выбранными файлами">
              <div class="toolbar__movement">
                <DnsIconButton class="icon-button" variant="tertiary" size="tiny" type="button" :disabled="!canMoveSelectionUp" :aria-label="selectedCount === 1 ? 'Переместить выбранный файл вверх' : 'Переместить выбранные файлы вверх'" @click="moveSelected(-1)">
                  <svg class="icon"><use href="#i-arrow-up" /></svg>
                </DnsIconButton>
                <DnsIconButton class="icon-button" variant="tertiary" size="tiny" type="button" :disabled="!canMoveSelectionDown" :aria-label="selectedCount === 1 ? 'Переместить выбранный файл вниз' : 'Переместить выбранные файлы вниз'" @click="moveSelected(1)">
                  <svg class="icon"><use href="#i-arrow-down" /></svg>
                </DnsIconButton>
              </div>
              <DnsLink class="toolbar__delete" tag="a" href="#" variant="danger" :disabled="!selectedCount" @click.prevent.stop="deleteSelected($event)">
                Удалить выбранные<span v-if="selectedIds.length"> ({{ selectedIds.length }})</span>
              </DnsLink>
            </div>

            <div class="toolbar__upload">
              <DnsLink class="toolbar__clear" tag="a" href="#" variant="danger" @click.prevent.stop="requestClearPackage($event)">
                Очистить пакет
              </DnsLink>
              <DnsButton class="button toolbar__add button--compact" variant="info" size="tiny" type="button" @click="openFilePicker">
                <template #icon-left><svg class="icon"><use href="#i-plus" /></svg></template>
                Добавить файлы
              </DnsButton>
            </div>
          </div>

          <input
            ref="fileInput"
            class="visually-hidden"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            multiple
            @change="handleFileInput"
          />

          <Teleport v-if="previewEnabled && currentPreviewFile && !mobilePreviewOpen" to="#file-preview-area">
          <section class="file-preview" aria-label="Предпросмотр файла">
            <header class="file-preview__header">
              <div ref="desktopPreviewSelectAnchor" class="file-preview__file-select-anchor" @click.stop>
                <DnsSelectInline
                  class="file-preview__file-select"
                  :class="{ 'file-preview__file-select--open': previewSelectOpen }"
                  :is-open="false"
                  :options="previewFileOptions"
                  position="left"
                  size="small"
                  aria-label="Файл для предпросмотра"
                  @click:input="previewSelectOpen = !previewSelectOpen"
                >
                  <template #label>Файл:</template>
                  <template #value>{{ currentPreviewFile.name }}</template>
                  <template #default="{ id, title, isSelected }">
                    <DnsRadioOption :is-selected="Boolean(isSelected)" @click="selectPreviewFile(id)">
                      {{ title }}
                    </DnsRadioOption>
                  </template>
                </DnsSelectInline>
              </div>

              <div class="file-preview__file-nav" aria-label="Переключение файлов">
                <span>Файл {{ currentPreviewIndex + 1 }} из {{ uploadedFiles.length }}</span>
                <div class="file-preview__file-nav-buttons">
                  <DnsIconButton class="icon-button icon-button--preview" variant="tertiary" size="small" type="button" :disabled="currentPreviewIndex <= 0" aria-label="Предыдущий файл" @click="navigatePreview(-1)">
                    <svg class="icon"><use href="#i-chevron-left" /></svg>
                  </DnsIconButton>
                  <DnsIconButton class="icon-button icon-button--preview" variant="tertiary" size="small" type="button" :disabled="currentPreviewIndex >= uploadedFiles.length - 1" aria-label="Следующий файл" @click="navigatePreview(1)">
                    <svg class="icon"><use href="#i-chevron-right" /></svg>
                  </DnsIconButton>
                </div>
              </div>
            </header>

            <div class="file-preview__canvas" :class="{ 'file-preview__canvas--pannable': currentPreviewIsImage && previewZoom > 1, 'file-preview__canvas--panning': previewPointer }" @pointerdown="beginPreviewPan" @pointermove="movePreviewPan" @pointerup="endPreviewPan" @pointercancel="endPreviewPan">
              <div
                class="file-preview__media"
                :class="currentPreviewIsImage ? 'file-preview__media--image' : 'file-preview__media--pdf'"
                :style="currentPreviewIsImage ? { transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})` } : undefined"
              >
                <img v-if="currentPreviewIsImage" :src="currentPreviewFile.previewUrl" :alt="'Предпросмотр ' + currentPreviewFile.name" draggable="false" />
                <PdfPreview v-else :url="currentPreviewFile.previewUrl" :source="currentPreviewFile.source" :page="previewPage" :zoom="previewZoom" @loaded="handlePdfLoaded" @page-change="previewPage = $event" @error="handlePdfError" />
              </div>
              <p v-if="previewError" class="file-preview__error" role="alert">{{ previewError }}</p>
            </div>

            <footer class="file-preview__controls" :class="{ 'file-preview__controls--image': currentPreviewIsImage }">
              <div class="file-preview__view-tools">
                <div class="file-preview__zoom dns-zoom-stepper" aria-label="Масштаб предпросмотра">
                  <DnsStepper
                    v-model="previewZoomStepperValue"
                    class="dns-zoom-stepper__control"
                    size="small"
                    color="gray"
                    :min="50"
                    :max="300"
                  />
                  <output class="dns-zoom-stepper__value" aria-live="polite">{{ previewZoomStepperLabel }}</output>
                </div>
                <DnsIconButton class="icon-button icon-button--preview" variant="tertiary" size="small" type="button" aria-label="Сбросить масштаб и положение" @click="resetPreviewZoom">
                  <svg class="icon"><use href="#i-rotate-left" /></svg>
                </DnsIconButton>
              </div>

              <div v-if="!currentPreviewIsImage" class="file-preview__page-nav" aria-label="Переключение страниц">
                <span>Стр. {{ previewPage }} из {{ currentPreviewPageCount }}</span>
                <div class="file-preview__page-nav-buttons">
                  <DnsIconButton class="icon-button icon-button--preview" variant="tertiary" size="small" type="button" :disabled="previewPage <= 1" aria-label="Предыдущая страница" @click="navigatePage(-1)">
                    <svg class="icon file-preview__chevron-up"><use href="#i-chevron" /></svg>
                  </DnsIconButton>
                  <DnsIconButton class="icon-button icon-button--preview" variant="tertiary" size="small" type="button" :disabled="previewPage >= currentPreviewPageCount" aria-label="Следующая страница" @click="navigatePage(1)">
                    <svg class="icon"><use href="#i-chevron" /></svg>
                  </DnsIconButton>
                </div>
              </div>

              <div v-if="currentPreviewIsImage" class="file-preview__crop-actions">
                <DnsButton variant="tertiary" size="small" type="button" @click="startCropping">
                  <template #icon-left><svg class="icon"><use href="#i-crop" /></svg></template>
                  Кадрировать
                </DnsButton>
              </div>
            </footer>
          </section>
          </Teleport>

          <DnsPopover
            v-if="previewSelectOpen && !isMobileViewport && currentPreviewFile"
            class="preview-file-popover"
            :reference="desktopPreviewSelectAnchor"
            position="bottom-start"
            :side-padding="4"
            :has-cross="false"
            @close="previewSelectOpen = false"
          >
            <template #content>
              <div class="preview-file-popover__content">
                <label class="preview-file-popover__search">
                  <span class="visually-hidden">Найти файл в списке</span>
                  <input v-model="previewFileSearch" type="search" placeholder="Найти в списке" autocomplete="off" />
                </label>
                <ul class="preview-file-popover__list">
                  <li v-for="option in filteredPreviewFileOptions" :key="option.id">
                    <button
                      type="button"
                      :class="{ 'preview-file-popover__option--selected': option.isSelected }"
                      @click="selectPreviewFile(option.id)"
                    >
                      <span>{{ option.title }}</span>
                      <svg v-if="option.isSelected" class="icon" aria-hidden="true"><use href="#i-check" /></svg>
                    </button>
                  </li>
                </ul>
                <p v-if="!filteredPreviewFileOptions.length" class="preview-file-popover__empty">Файлы не найдены</p>
              </div>
            </template>
          </DnsPopover>

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
                <DnsIconButton class="icon-button icon-button--alert-close" variant="tertiary" size="small" type="button" aria-label="Закрыть уведомление об ошибке загрузки" @click="dismissErrorAlert">
                  <svg class="icon"><use href="#i-close" /></svg>
                </DnsIconButton>
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

            <DnsButton
              class="upload-errors__toggle"
              variant="tertiary"
              size="small"
              type="button"
              :aria-expanded="errorAlertExpanded"
              aria-controls="upload-errors-list"
              @click="toggleErrorAlert"
            >
              {{ errorAlertExpanded ? 'Свернуть' : 'Подробнее' }}
              <template #icon-right>
                <svg class="icon" :class="{ 'upload-errors__toggle-icon--expanded': errorAlertExpanded }"><use href="#i-chevron" /></svg>
              </template>
            </DnsButton>
          </section>

          <div v-if="uploadedFiles.length" class="files-table-wrap">
            <table class="files-table">
              <thead>
                <tr>
                  <th class="cell-check">
                    <DnsCheckbox
                      class="checkbox-control"
                      :class="{ 'checkbox-control--indeterminate': hasPartialSelection }"
                      :checked="allSelected || hasPartialSelection"
                      :disabled="!uploadedFiles.length"
                      size="big"
                      aria-label="Выбрать все файлы в пакете"
                      @vue-click="toggleAllSelection"
                    />
                  </th>
                  <th class="cell-name">Имя файла</th>
                  <th class="cell-size">Размер файла, МБ</th>
                  <th class="cell-pages">Кол-во страниц</th>
                  <th class="cell-actions">Действия</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(file, index) in uploadedFiles"
                  :key="file.id"
                  :data-reorder-file-id="file.id"
                  :class="{
                    'files-table__row--selected': selectedIds.includes(file.id),
                    'files-table__row--previewed': previewEnabled && index === currentPreviewIndex,
                    'files-table__row--holding': reorderDrag.pending && reorderDrag.fileId === file.id,
                    'files-table__row--dragging': reorderDrag.active && reorderDrag.fileId === file.id,
                  }"
                  @pointerdown="beginFileReorder($event, file.id)"
                  @pointermove="moveFileReorder"
                  @pointerup="finishFileReorder"
                  @pointercancel="finishFileReorder($event, true)"
                  @contextmenu="preventFileReorderContextMenu"
                >
                  <td class="cell-check">
                    <DnsCheckbox
                      class="checkbox-control"
                      :checked="selectedIds.includes(file.id)"
                      size="big"
                      :aria-label="`Выбрать ${file.name}`"
                      @vue-click="toggleFileSelection(file.id)"
                    />
                  </td>
                  <td class="cell-name">
                    <div class="file-name-cell">
                      <span :title="file.name">{{ file.name }}</span>
                    </div>
                  </td>
                  <td class="cell-size">{{ formatSize(file.size) }}</td>
                  <td class="cell-pages">{{ file.pages }}</td>
                  <td class="cell-actions">
                    <DnsIconButton class="icon-button icon-button--table" variant="secondary" size="small" type="button" :aria-label="'Удалить ' + file.name" @click.stop="deleteFile(file.id, $event)">
                      <svg class="icon"><use href="#i-trash" /></svg>
                    </DnsIconButton>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <section v-else class="desktop-empty-state" aria-labelledby="desktop-empty-title">
            <img class="desktop-empty-state__image" :src="emptyStateImage" width="218" height="240" alt="" aria-hidden="true" draggable="false" />
            <div class="desktop-empty-state__message">
              <h2 id="desktop-empty-title">В пакете пока нет документов</h2>
              <p>
                Перетащите файлы или
                <DnsLink class="desktop-empty-state__picker" tag="button" type="button" @click="openFilePicker">
                  выберите их на компьютере
                </DnsLink>.<br />
                Поддерживаются PDF, JPG, JPEG и PNG.
              </p>
            </div>
            <DnsLink class="desktop-empty-state__help" tag="a" href="#upload-help">Как загружать документы</DnsLink>
          </section>
          <DnsLink v-if="uploadedFiles.length" id="upload-help" class="table-help-link" tag="a" href="#upload-help">
            Как загружать документы
          </DnsLink>
          <section v-if="uploadedFiles.length" class="mobile-file-list" aria-label="Файлы в пакете">
            <header class="mobile-file-list__header">
              <DnsCheckbox
                class="mobile-checkbox"
                :class="{ 'mobile-checkbox--indeterminate': hasPartialSelection }"
                :checked="allSelected || hasPartialSelection"
                :disabled="!uploadedFiles.length"
                aria-label="Выбрать все файлы в пакете"
                @vue-click="toggleAllSelection"
              >
                <template #label>Выбрать все</template>
              </DnsCheckbox>
              <DnsButton class="button mobile-file-list__add" variant="info" size="small" type="button" @click="openFilePicker">Добавить файлы</DnsButton>
            </header>

            <ul ref="mobileFileListItems" class="mobile-file-list__items" :class="{ 'mobile-file-list__items--selection-active': selectedCount }" @scroll.passive="scheduleMobileListScrollbarUpdate">
              <DnsListRow
                v-for="file in uploadedFiles"
                :key="file.id"
                tag="li"
                class="mobile-file-list__item"
                :class="{
                  'mobile-file-list__item--holding': reorderDrag.pending && reorderDrag.fileId === file.id,
                  'mobile-file-list__item--dragging': reorderDrag.active && reorderDrag.fileId === file.id,
                }"
                :data-file-id="file.id"
                :data-reorder-file-id="file.id"
                @pointerdown="beginFileReorder($event, file.id)"
                @pointermove="moveFileReorder"
                @pointerup="finishFileReorder"
                @pointercancel="finishFileReorder($event, true)"
                @contextmenu="preventFileReorderContextMenu"
              >
                <template #left>
                  <DnsCheckbox
                    class="mobile-checkbox"
                    :checked="selectedIds.includes(file.id)"
                    :aria-label="`Выбрать ${file.name}`"
                    @vue-click="toggleFileSelection(file.id)"
                  />
                </template>
                <div class="mobile-file-list__file">
                  <strong :title="file.name">{{ file.name }}</strong>
                  <small>{{ formatSize(file.size) }} МБ • {{ file.pages }} стр.</small>
                </div>
                <template #right>
                  <DnsIconButton class="icon-button mobile-file-list__delete" variant="secondary" size="tiny" type="button" :aria-label="'Удалить ' + file.name" @click.stop="deleteFile(file.id, $event)">
                    <svg class="icon"><use href="#i-trash" /></svg>
                  </DnsIconButton>
                </template>
              </DnsListRow>
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

          <section v-else id="upload-help" class="mobile-empty-state" aria-labelledby="mobile-empty-title">
            <img class="mobile-empty-state__image" :src="emptyStateImage" width="145" height="160" alt="" aria-hidden="true" draggable="false" />
            <div class="mobile-empty-state__text">
              <h2 id="mobile-empty-title">В пакете пока нет документов</h2>
              <p>Поддерживаются PDF, JPG, JPEG и PNG.</p>
            </div>
            <DnsButton class="button button--primary mobile-empty-state__add" variant="primary" size="small" type="button" @click="openFilePicker">
              Добавить файлы
            </DnsButton>
            <DnsLink class="mobile-empty-state__help" tag="a" href="#upload-help">Как загружать документы</DnsLink>
          </section>
          <div v-if="dragActive" class="upload-drop-overlay" role="status" aria-live="polite">
            <span class="upload-drop-overlay__message">Перемещенные файлы будут добавлены в пакет</span>
          </div>
          </div>
        </div>
        </div>
      </section>
    </main>

    <aside v-if="selectedCount" class="mobile-selection-bar" aria-label="Действия с выбранными файлами">
      <div class="mobile-selection-bar__moves">
        <DnsIconButton class="icon-button" variant="tertiary" size="small" type="button" :disabled="!canMoveSelectionUp" :aria-label="selectedCount === 1 ? 'Переместить выбранный файл вверх' : 'Переместить выбранные файлы вверх'" @click="moveSelected(-1)"><svg class="icon"><use href="#i-arrow-up" /></svg></DnsIconButton>
        <DnsIconButton class="icon-button" variant="tertiary" size="small" type="button" :disabled="!canMoveSelectionDown" :aria-label="selectedCount === 1 ? 'Переместить выбранный файл вниз' : 'Переместить выбранные файлы вниз'" @click="moveSelected(1)"><svg class="icon"><use href="#i-arrow-down" /></svg></DnsIconButton>
      </div>
      <DnsLink class="mobile-selection-bar__delete" tag="a" href="#" variant="danger" @click.prevent.stop="deleteSelected($event)">Удалить выбранные ({{ selectedCount }})</DnsLink>
    </aside>

    <div v-if="uploadedFiles.length" class="mobile-primary-actions">
      <DnsButton class="button button--secondary mobile-primary-actions__draft" variant="secondary" size="small" type="button" @click="saveDraft">{{ draftSaved ? 'Сохранено' : 'Сохранить' }}</DnsButton>
      <DnsButton class="button button--primary mobile-primary-actions__send" variant="primary" size="small" type="button" :disabled="!canSend" @click="sendPackage">Отправить</DnsButton>
    </div>

    <DnsPopover
      v-if="mobileActionsMenuOpen"
      class="mobile-actions-popover"
      :reference="mobileActionsReference"
      position="bottom-end"
      :side-padding="8"
      :has-cross="false"
      @close="mobileActionsMenuOpen = false"
    >
      <template #content>
        <DnsFlatMenu
          id="mobile-actions-sheet"
          class="mobile-actions-menu"
          size="small"
          :has-padding="false"
          role="menu"
          aria-label="Действия с пакетом"
        >
          <DnsMenuItem :has-arrow="false" role="menuitem" @click="openMobilePreview">
            <template #title>Предпросмотр</template>
          </DnsMenuItem>
          <DnsMenuItem class="mobile-actions-menu__clear" type="danger" border="top" :has-arrow="false" role="menuitem" @click.stop="clearPackageFromMobileSheet">
            <template #title>Очистить все</template>
          </DnsMenuItem>
        </DnsFlatMenu>
      </template>
    </DnsPopover>

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
          <DnsIconButton class="mobile-preview-dialog__close" variant="tertiary" size="small" type="button" aria-label="Закрыть предпросмотр" @click="closeMobilePreview">
            <svg class="icon"><use href="#i-close" /></svg>
          </DnsIconButton>
        </header>

        <main class="mobile-preview-dialog__body">
          <DnsSelectInline
            class="mobile-preview-dialog__file-select"
            :is-open="false"
            :options="previewFileOptions"
            position="left"
            size="small"
            aria-label="Файл для предпросмотра"
            @click:input="previewSelectOpen = !previewSelectOpen"
            @close="previewSelectOpen = false"
          >
            <template #value>{{ currentPreviewFile.name }}</template>
            <template #default="{ id, title, isSelected }">
              <DnsRadioOption :is-selected="Boolean(isSelected)" @click="selectPreviewFile(id)">
                {{ title }}
              </DnsRadioOption>
            </template>
          </DnsSelectInline>

          <div class="mobile-preview-dialog__file-nav">
            <span>Файл {{ currentPreviewIndex + 1 }} из {{ uploadedFiles.length }}</span>
            <div aria-label="Переключение файлов">
              <DnsIconButton class="mobile-preview-dialog__icon-button" variant="tertiary" size="small" type="button" :disabled="currentPreviewIndex <= 0" aria-label="Предыдущий файл" @click="navigatePreview(-1)">
                <svg class="icon"><use href="#i-chevron-left" /></svg>
              </DnsIconButton>
              <DnsIconButton class="mobile-preview-dialog__icon-button" variant="tertiary" size="small" type="button" :disabled="currentPreviewIndex >= uploadedFiles.length - 1" aria-label="Следующий файл" @click="navigatePreview(1)">
                <svg class="icon"><use href="#i-chevron-right" /></svg>
              </DnsIconButton>
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
          <div class="mobile-preview-dialog__zoom dns-zoom-stepper" aria-label="Масштаб предпросмотра">
            <DnsStepper
              v-model="previewZoomStepperValue"
              class="dns-zoom-stepper__control"
              size="small"
              color="gray"
              :min="50"
              :max="300"
            />
            <output class="dns-zoom-stepper__value" aria-live="polite">{{ previewZoomStepperLabel }}</output>
          </div>

          <DnsIconButton class="mobile-preview-dialog__reset" variant="tertiary" size="small" type="button" aria-label="Сбросить масштаб и положение" @click="resetPreviewZoom">
            <svg class="icon"><use href="#i-rotate-left" /></svg>
          </DnsIconButton>

          <DnsButton
            v-if="currentPreviewIsImage"
            class="mobile-preview-dialog__crop"
            variant="tertiary"
            size="small"
            type="button"
            @click="startCropping"
          >
            Кадрировать
          </DnsButton>

          <span v-else class="mobile-preview-dialog__page-count">Стр. {{ previewPage }} из {{ currentPreviewPageCount }}</span>

          <div v-if="!currentPreviewIsImage" class="mobile-preview-dialog__page-nav" aria-label="Переключение страниц">
            <DnsIconButton class="dns-icon-button" variant="tertiary" size="small" type="button" :disabled="currentPreviewIsImage || previewPage <= 1" aria-label="Предыдущая страница" @click="navigatePage(-1)">
              <svg class="icon mobile-preview-dialog__chevron-up"><use href="#i-chevron" /></svg>
            </DnsIconButton>
            <DnsIconButton class="dns-icon-button" variant="tertiary" size="small" type="button" :disabled="currentPreviewIsImage || previewPage >= currentPreviewPageCount" aria-label="Следующая страница" @click="navigatePage(1)">
              <svg class="icon"><use href="#i-chevron" /></svg>
            </DnsIconButton>
          </div>
        </footer>
      </section>
    </Teleport>

    <DnsBottomSheet
      v-if="mobilePreviewOpen && previewSelectOpen"
      class="preview-file-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Выбор файла для предпросмотра"
      @close="previewSelectOpen = false"
    >
      <div class="preview-file-sheet__content">
        <label class="preview-file-sheet__search">
          <span class="visually-hidden">Найти файл в списке</span>
          <input v-model="previewFileSearch" type="search" placeholder="Найти в списке" autocomplete="off" />
        </label>
        <ul class="preview-file-sheet__list">
          <li v-for="option in filteredPreviewFileOptions" :key="option.id">
            <button
              type="button"
              :class="{ 'preview-file-sheet__option--selected': option.isSelected }"
              @click="selectPreviewFile(option.id)"
            >
              <span>{{ option.title }}</span>
              <svg v-if="option.isSelected" class="icon" aria-hidden="true"><use href="#i-check" /></svg>
            </button>
          </li>
        </ul>
        <p v-if="!filteredPreviewFileOptions.length" class="preview-file-sheet__empty">Файлы не найдены</p>
      </div>
    </DnsBottomSheet>

    <DnsModal
        v-if="cropMode"
        class="crop-dialog"
        size="xl"
        role="dialog"
        aria-labelledby="crop-dialog-title"
        aria-describedby="crop-dialog-description"
        tabindex="-1"
        @close="cancelCropping"
    >
      <template #header>
        <header class="crop-dialog__header">
          <h2 id="crop-dialog-title">Кадрирование</h2>
          <p id="crop-dialog-description" class="visually-hidden">Выберите формат страницы и расположите документ в пределах рамки.</p>
          <DnsIconButton class="icon-button icon-button--alert-close" variant="tertiary" size="small" type="button" aria-label="Закрыть кадрирование" @click="cancelCropping">
            <svg class="icon"><use href="#i-close" /></svg>
          </DnsIconButton>
        </header>
      </template>

        <div class="crop-dialog__content">
          <div class="crop-dialog__meta">
            <p class="crop-dialog__file-name" :title="currentPreviewFile.name">{{ currentPreviewFile.name }}</p>
            <DnsSelectInline
              id="crop-format"
              class="crop-dialog__format"
              :is-open="cropFormatSelectOpen"
              :options="cropFormatOptions"
              position="right"
              size="small"
              aria-label="Формат изображения"
              @click:input="cropFormatSelectOpen = !cropFormatSelectOpen"
              @close="cropFormatSelectOpen = false"
            >
              <template #label>Формат изображения</template>
              <template #value>{{ cropFormatTitle }}</template>
              <template #default="{ id, title, isSelected }">
                <DnsRadioOption :is-selected="Boolean(isSelected)" @click="selectCropFormat(id)">
                  {{ title }}
                </DnsRadioOption>
              </template>
            </DnsSelectInline>
          </div>

          <div class="crop-dialog__stage">
            <ReactEasyCrop
              :image="currentPreviewFile.previewUrl"
              v-model:crop="crop"
              v-model:zoom="cropZoom"
              v-model:rotation="cropRotation"
              :aspect="cropAspect"
              @crop-complete="cropPixels = $event"
            />
          </div>

          <div class="crop-dialog__toolbar">
            <div class="crop-dialog__zoom dns-zoom-stepper" aria-label="Масштаб кадрирования">
              <DnsStepper
                v-model="cropZoomStepperValue"
                class="dns-zoom-stepper__control"
                size="small"
                color="gray"
                :min="100"
                :max="300"
              />
              <output class="dns-zoom-stepper__value" aria-live="polite">{{ cropZoomStepperLabel }}</output>
            </div>
            <DnsIconButton class="icon-button crop-dialog__reset" variant="tertiary" size="small" type="button" aria-label="Сбросить положение и масштаб" @click="changeCropFormat">
              <svg class="icon"><use href="#i-refresh" /></svg>
            </DnsIconButton>
            <div class="crop-dialog__rotate" aria-label="Поворот изображения">
              <DnsIconButton class="icon-button" variant="tertiary" size="small" type="button" aria-label="Повернуть влево" @click="rotateCrop(-90)">
                <svg class="icon"><use href="#i-rotate-left" /></svg>
              </DnsIconButton>
              <DnsIconButton class="icon-button" variant="tertiary" size="small" type="button" aria-label="Повернуть вправо" @click="rotateCrop(90)">
                <svg class="icon"><use href="#i-rotate-right" /></svg>
              </DnsIconButton>
            </div>
          </div>
        </div>

        <template #footer>
          <footer class="crop-dialog__actions">
            <DnsButton class="button button--primary" variant="primary" type="button" :disabled="!cropPixels" @click="applyCrop">Применить</DnsButton>
            <DnsButton class="button button--secondary" variant="secondary" type="button" @click="cancelCropping">Отмена</DnsButton>
          </footer>
        </template>
    </DnsModal>

    <DnsPopover
      v-if="deletionConfirmationVisible && deletionPopoverAnchor && !isMobileViewport"
      class="delete-confirm-popover"
      :reference="deletionPopoverAnchor"
      position="bottom-end"
      :side-padding="8"
      :has-cross="false"
      role="alertdialog"
      aria-labelledby="delete-confirm-title"
      aria-describedby="delete-confirm-description"
      @close="cancelDeletion"
    >
      <template #content>
        <div class="delete-confirm-popover__content">
          <div class="delete-confirm-popover__copy">
            <h2 id="delete-confirm-title">{{ deletionConfirmationTitle }}</h2>
            <p id="delete-confirm-description">
              {{ singleFilePendingDeletion ? singleFilePendingDeletion.name : deletionConfirmationDescription }}
            </p>
          </div>
          <div class="delete-confirm-popover__actions">
            <DnsButton variant="danger" size="medium" type="button" @click="confirmDestructiveAction">
              {{ pendingClearPackage ? 'Очистить' : 'Удалить' }}
            </DnsButton>
            <DnsButton variant="secondary" size="medium" type="button" @click="cancelDeletion">Оставить</DnsButton>
          </div>
        </div>
      </template>
    </DnsPopover>

    <DnsBottomSheet
      v-if="deletionConfirmationVisible && isMobileViewport"
      class="delete-confirm-sheet"
      role="alertdialog"
      aria-modal="true"
      :aria-labelledby="singleFilePendingDeletion ? undefined : 'mobile-delete-confirm-title'"
      aria-describedby="mobile-delete-confirm-description"
      @close="cancelDeletion"
    >
      <template v-if="!singleFilePendingDeletion" #header>
        <h2 id="mobile-delete-confirm-title" class="delete-confirm-sheet__title">
          {{ deletionConfirmationTitle }}
        </h2>
      </template>

      <div class="delete-confirm-sheet__body">
        <p v-if="singleFilePendingDeletion" id="mobile-delete-confirm-description">
          Удалить файл <strong>{{ singleFilePendingDeletion.name }}</strong>?
        </p>
        <p v-else id="mobile-delete-confirm-description">{{ deletionConfirmationDescription }}</p>
      </div>

      <template #footer>
        <div class="delete-confirm-sheet__actions">
          <DnsButton variant="danger" size="medium" type="button" @click="confirmDestructiveAction">
            {{ pendingClearPackage ? 'Очистить' : 'Удалить' }}
          </DnsButton>
          <DnsButton variant="secondary" size="medium" type="button" @click="cancelDeletion">Оставить</DnsButton>
        </div>
      </template>
    </DnsBottomSheet>

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

      <DnsIconButton class="icon-button icon-button--quiet upload-notification__close" variant="tertiary" size="small" type="button" aria-label="Закрыть уведомление о добавлении файлов" @click="closeUploadPanel">
        <svg class="icon"><use href="#i-close" /></svg>
      </DnsIconButton>
    </aside>

    <span ref="uploadPopoverAnchor" class="upload-popover-anchor" aria-hidden="true" />

    <DnsPopover
      v-if="uploadPanelVisible && statusDisplayMode === 'popover' && !isMobileViewport"
      class="upload-status-popover"
      :class="{ 'upload-status-popover--collapsed': !uploadPanelExpanded }"
      :reference="uploadPopoverAnchor"
      position="top-end"
      :side-padding="0"
      :has-cross="false"
      role="region"
      aria-labelledby="upload-status-popover-title"
      @close="closeDesktopUploadPanel"
    >
      <template #header="{ close }">
        <div class="upload-status-popover__header-content">
          <span id="upload-status-popover-title" class="upload-status-popover__title">{{ uploadPopoverTitle }}</span>
          <div class="upload-status-popover__header-actions">
            <button
            class="upload-status-popover__collapse"
            type="button"
            :aria-expanded="uploadPanelExpanded"
            aria-controls="upload-status-popover-content"
            :aria-label="uploadPanelExpanded ? 'Свернуть статус загрузки' : 'Развернуть статус загрузки'"
            @click="uploadPanelExpanded = !uploadPanelExpanded"
          >
            <svg class="icon upload-status-popover__chevron" :class="{ 'upload-status-popover__chevron--expanded': uploadPanelExpanded }" aria-hidden="true"><use href="#i-chevron" /></svg>
          </button>
            <button class="upload-status-popover__close" type="button" aria-label="Закрыть статус загрузки" @click="close">
              <svg class="icon"><use href="#i-close" /></svg>
            </button>
          </div>
        </div>
      </template>

      <template #content>
        <div v-show="uploadPanelExpanded" id="upload-status-popover-content" class="upload-status-popover__content">
          <p
            v-if="uploadPopoverDescription"
            class="upload-status-popover__description"
            :aria-live="uploadingActivityCount ? 'off' : 'polite'"
            aria-atomic="true"
          >
            {{ uploadPopoverDescription }}
          </p>
          <div v-if="uploadingActivityCount" class="upload-status-popover__overall-progress" role="progressbar" :aria-valuenow="activityOverallProgress" aria-valuemin="0" aria-valuemax="100" aria-label="Общий прогресс загрузки">
            <span :style="{ width: activityOverallProgress + '%' }" />
          </div>

          <div class="upload-status-popover__body">
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
        </div>
      </template>
    </DnsPopover>

    <DnsBottomSheet
      v-if="uploadPanelVisible && statusDisplayMode === 'popover' && isMobileViewport"
      class="upload-popover upload-bottom-sheet"
      role="region"
      aria-labelledby="upload-bottom-sheet-title"
      @close="closeMobileUploadPanel"
    >
      <template #header="{ close }">
        <header class="upload-popover__header">
          <div class="upload-popover__heading">
            <h2 id="upload-bottom-sheet-title">{{ uploadPopoverTitle }}</h2>
            <div class="upload-popover__actions">
              <DnsIconButton v-if="!uploadingActivityCount" class="upload-popover__icon-button" variant="tertiary" size="small" type="button" aria-label="Закрыть статус загрузки" @click="close">
                <svg class="icon"><use href="#i-close" /></svg>
              </DnsIconButton>
            </div>
          </div>
          <p
            v-if="uploadPopoverDescription"
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
      </template>

      <div id="upload-popover-body" class="upload-popover__body">
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

      <template v-if="!uploadingActivityCount && uploadedCount" #footer="{ close }">
        <footer class="upload-bottom-sheet__footer">
          <DnsButton class="button button--primary upload-bottom-sheet__cta" variant="primary" size="large" type="button" @click="goToPackage(close)">
            Перейти к пакету
          </DnsButton>
          <DnsButton class="button button--secondary upload-bottom-sheet__cta" variant="secondary" size="large" type="button" @click="addMoreFiles(close)">
            Добавить ещё
          </DnsButton>
        </footer>
      </template>
    </DnsBottomSheet>

    <div class="visually-hidden" aria-live="polite" aria-atomic="true">{{ statusMessage }}</div>

    <DnsSnackbar
      v-if="packageSent"
      class="toast"
      :has-cross="false"
      is-manual
      role="status"
      @close="packageSent = false"
    >
      <template #title>Пакет успешно отправлен</template>
      <template #action>
        <button class="toast__action" type="button" @click="goToPackage()">Перейти к пакету</button>
      </template>
    </DnsSnackbar>
  </div>
</template>
