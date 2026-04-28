<template>
  <q-dialog v-model="showDialog" maximized @hide="persistProgramSettings">
    <q-card>
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">Settings</div>
        <q-space />
        <q-btn icon="close" flat round dense @click="closeDialog" />
      </q-card-section>

      <q-card-section>
        <q-tabs
          v-model="activeTab"
          dense
          class="text-grey"
          active-color="primary"
          indicator-color="primary"
          align="left"
        >
          <q-tab name="program" label="Program Settings" />
          <q-tab name="project" label="Project Settings" />
        </q-tabs>

        <q-separator />

        <q-tab-panels v-model="activeTab" animated>
          <!-- Program Settings Tab -->
          <q-tab-panel name="program">
            <div class="text-h6 q-mb-md">Program-Wide Settings</div>

            <div class="q-mb-lg">
              <div class="text-subtitle1 q-mb-sm">Auto-Versioning</div>
              <q-option-group
                v-model="programSettings.autoVersioning"
                :options="autoVersioningOptions"
                type="checkbox"
                class="q-mb-md"
              />

              <div v-if="programSettings.autoVersioning.includes('interval')" class="q-ml-md">
                <q-input
                  v-model.number="programSettings.versioningInterval"
                  type="number"
                  label="Minutes between auto-saves"
                  min="1"
                  max="60"
                  style="max-width: 200px"
                />
              </div>
            </div>

            <q-separator class="q-my-md" />

            <div class="q-mb-lg">
              <div class="text-subtitle1 q-mb-sm">Default Settings for New Projects</div>
              <div class="row q-col-gutter-md">
                <div class="col-12 col-md-6">
                  <q-slider
                    v-model="programSettings.defaultFontSize"
                    :min="12"
                    :max="40"
                    :step="1"
                    label
                    label-always
                    :label-value="'Font size: ' + programSettings.defaultFontSize + 'px'"
                  />
                </div>
                <div class="col-12 col-md-6">
                  <q-slider
                    v-model="programSettings.defaultIndentSize"
                    :min="5"
                    :max="50"
                    :step="1"
                    label
                    label-always
                    :label-value="'Indent size: ' + programSettings.defaultIndentSize + 'px'"
                  />
                </div>
              </div>
            </div>

            <q-separator class="q-my-md" />

            <div class="q-mb-lg">
              <div class="text-subtitle1 q-mb-sm">Default Typography for New Projects</div>
              <div class="text-caption text-grey-8 q-mb-xs">Tibetan</div>
              <div class="typography-row q-mb-sm">
                <q-select
                  v-model="programSettings.defaultTibetanFontFamily"
                  :options="fontFamilyOptions"
                  label="Font Family"
                  outlined
                  dense
                  emit-value
                  map-options
                  class="family-field"
                />
                <q-btn
                  class="color-swatch"
                  :style="{ backgroundColor: programSettings.defaultTibetanFontColor }"
                  aria-label="Tibetan text color"
                >
                  <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                    <q-card>
                      <q-card-section class="q-pa-sm">
                        <q-color
                          v-model="programSettings.defaultTibetanFontColor"
                          no-header
                          no-footer
                        />
                      </q-card-section>
                    </q-card>
                  </q-popup-proxy>
                </q-btn>
                <q-select
                  v-model="programSettings.defaultTibetanFontSize"
                  :options="fontSizeOptions"
                  label="Size"
                  outlined
                  dense
                  emit-value
                  map-options
                  class="size-field"
                />
              </div>

              <div class="text-caption text-grey-8 q-mb-xs">Non-Tibetan</div>
              <div class="typography-row">
                <q-select
                  v-model="programSettings.defaultNonTibetanFontFamily"
                  :options="fontFamilyOptions"
                  label="Font Family"
                  outlined
                  dense
                  emit-value
                  map-options
                  class="family-field"
                />
                <q-btn
                  class="color-swatch"
                  :style="{ backgroundColor: programSettings.defaultNonTibetanFontColor }"
                  aria-label="Non-Tibetan text color"
                >
                  <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                    <q-card>
                      <q-card-section class="q-pa-sm">
                        <q-color
                          v-model="programSettings.defaultNonTibetanFontColor"
                          no-header
                          no-footer
                        />
                      </q-card-section>
                    </q-card>
                  </q-popup-proxy>
                </q-btn>
                <q-select
                  v-model="programSettings.defaultNonTibetanFontSize"
                  :options="fontSizeOptions"
                  label="Size"
                  outlined
                  dense
                  emit-value
                  map-options
                  class="size-field"
                />
              </div>
            </div>

            <q-separator class="q-my-md" />

            <div class="q-mb-lg">
              <div class="text-subtitle1 q-mb-sm">Media Storage</div>
              <div class="text-caption text-grey-8 q-mb-sm">
                Active backend: <strong>{{ mediaBackendLabel }}</strong>
                <span class="q-ml-sm">
                  ({{ mediaUsage.count }} files,
                  {{ formatBytes(mediaUsage.bytes) }})
                </span>
              </div>

              <div v-if="!userFolderApiAvailable" class="text-caption text-grey-7 q-mb-sm">
                Choosing a folder for media storage requires a Chromium-based browser
                (Chrome, Edge, or Brave). Other browsers will continue to use
                <span v-if="opfsApiAvailable">the Origin Private File System</span>
                <span v-else>IndexedDB</span> automatically.
              </div>

              <div v-else class="q-mb-sm">
                <div v-if="userFolderConfigured" class="row items-center q-gutter-sm">
                  <q-icon name="folder" color="primary" />
                  <span class="text-body2">
                    Media is being stored in a folder you chose.
                    <span
                      v-if="userFolderPermissionState && userFolderPermissionState !== 'granted'"
                      class="text-warning"
                    >
                      (Permission needs to be re-granted on next upload.)
                    </span>
                  </span>
                  <q-space />
                  <q-btn
                    flat
                    dense
                    color="primary"
                    label="Change folder…"
                    :loading="isPickingFolder"
                    @click="chooseMediaFolder"
                  />
                  <q-btn
                    flat
                    dense
                    color="negative"
                    label="Disconnect"
                    @click="disconnectMediaFolder"
                  />
                </div>

                <div v-else class="row items-center q-gutter-sm">
                  <q-icon name="info" color="grey-7" />
                  <span class="text-body2">
                    By default, media stays inside the browser. You can store it in
                    a folder of your choice instead — useful for syncing via
                    iCloud, Dropbox, etc.
                  </span>
                  <q-space />
                  <q-btn
                    color="primary"
                    label="Choose folder…"
                    :loading="isPickingFolder"
                    @click="chooseMediaFolder"
                  />
                </div>
              </div>
            </div>
          </q-tab-panel>

          <!-- Project Settings Tab -->
          <q-tab-panel name="project">
            <div class="text-h6 q-mb-md">Settings for: {{ currentProject?.name }}</div>

            <q-banner
              v-if="currentProject"
              dense
              rounded
              class="bg-blue-1 text-blue-10 q-mb-lg"
            >
              <div class="text-subtitle2">Project storage usage</div>
              <div class="text-body2">Total: {{ formatBytes(projectStorageUsage.totalBytes) }}</div>
              <div class="text-caption">
                Media: {{ formatBytes(projectStorageUsage.mediaBytes) }} (Images:
                {{ formatBytes(projectStorageUsage.imageBytes) }}, Audio:
                {{ formatBytes(projectStorageUsage.audioBytes) }})
              </div>
            </q-banner>

            <div class="q-mb-lg">
              <div class="text-subtitle1 q-mb-sm">Display Settings</div>
              <div class="row q-col-gutter-md">
                <div class="col-12 col-md-6">
                  <q-slider
                    v-model="fontScale"
                    :min="50"
                    :max="200"
                    :step="1"
                    label
                    label-always
                    :label-value="'Font Scale: ' + fontScale + '%'"
                    @update:model-value="store.setFontScale"
                  />
                </div>
                <div class="col-12 col-md-6">
                  <q-slider
                    v-model="indentSize"
                    :min="5"
                    :max="50"
                    :step="1"
                    label
                    label-always
                    :label-value="'Indent Size: ' + indentSize + 'px'"
                    @update:model-value="store.setIndentSize"
                  />
                </div>
              </div>

              <q-checkbox
                v-model="showIndentGuides"
                label="Show indent guides"
                @update:model-value="store.setShowIndentGuides"
              />
            </div>

            <q-separator class="q-my-md" />

            <div class="q-mb-lg">
              <div class="text-subtitle1 q-mb-sm">Default List Type</div>
              <q-radio
                v-model="defaultListType"
                val="ordered"
                label="Numbered (1, 2, 3)"
                @update:model-value="store.setDefaultListType"
              />
              <q-radio
                v-model="defaultListType"
                val="unordered"
                label="Bulleted (•)"
                @update:model-value="store.setDefaultListType"
              />
            </div>

            <q-separator class="q-my-md" />

            <div class="q-mb-lg">
              <div class="text-subtitle1 q-mb-sm">Project Typography</div>
              <div class="text-caption text-grey-8 q-mb-xs">Tibetan</div>
              <div class="typography-row q-mb-sm">
                <q-select
                  v-model="tibetanFontFamily"
                  :options="fontFamilyOptions"
                  label="Font Family"
                  outlined
                  dense
                  emit-value
                  map-options
                  class="family-field"
                  @update:model-value="store.setTibetanFontFamily"
                />
                <q-btn
                  class="color-swatch"
                  :style="{ backgroundColor: tibetanFontColor }"
                  aria-label="Project Tibetan text color"
                >
                  <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                    <q-card>
                      <q-card-section class="q-pa-sm">
                        <q-color
                          :model-value="tibetanFontColor"
                          no-header
                          no-footer
                          @update:model-value="store.setTibetanFontColor"
                        />
                      </q-card-section>
                    </q-card>
                  </q-popup-proxy>
                </q-btn>
                <q-select
                  v-model="tibetanFontSize"
                  :options="fontSizeOptions"
                  label="Size"
                  outlined
                  dense
                  emit-value
                  map-options
                  class="size-field"
                  @update:model-value="store.setTibetanFontSize"
                />
              </div>

              <div class="text-caption text-grey-8 q-mb-xs">Non-Tibetan</div>
              <div class="typography-row">
                <q-select
                  v-model="nonTibetanFontFamily"
                  :options="fontFamilyOptions"
                  label="Font Family"
                  outlined
                  dense
                  emit-value
                  map-options
                  class="family-field"
                  @update:model-value="store.setNonTibetanFontFamily"
                />
                <q-btn
                  class="color-swatch"
                  :style="{ backgroundColor: nonTibetanFontColor }"
                  aria-label="Project non-Tibetan text color"
                >
                  <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                    <q-card>
                      <q-card-section class="q-pa-sm">
                        <q-color
                          :model-value="nonTibetanFontColor"
                          no-header
                          no-footer
                          @update:model-value="store.setNonTibetanFontColor"
                        />
                      </q-card-section>
                    </q-card>
                  </q-popup-proxy>
                </q-btn>
                <q-select
                  v-model="nonTibetanFontSize"
                  :options="fontSizeOptions"
                  label="Size"
                  outlined
                  dense
                  emit-value
                  map-options
                  class="size-field"
                  @update:model-value="store.setNonTibetanFontSize"
                />
              </div>
            </div>

            <q-separator class="q-my-md" />

            <div class="q-mb-lg">
              <q-btn
                label="Save Version Now"
                color="primary"
                icon="save"
                @click="showSaveVersionDialog = true"
              />
            </div>

            <q-separator class="q-my-md" />

            <div>
              <div class="text-subtitle1 q-mb-md">Version History</div>

              <div v-if="versions.length === 0" class="text-grey">No versions saved yet</div>

              <q-list v-else separator>
                <q-item v-for="version in versions" :key="version.id" class="q-pa-md">
                  <q-item-section>
                    <q-item-label>
                      {{ version.name || formatDate(version.timestamp) }}
                    </q-item-label>
                    <q-item-label caption>
                      {{ formatDate(version.timestamp) }}
                      <span v-if="version.trigger" class="q-ml-sm"> ({{ version.trigger }}) </span>
                    </q-item-label>
                    <q-item-label caption>
                      {{ version.stats.items }} items, {{ version.stats.notes }} notes
                    </q-item-label>
                  </q-item-section>

                  <q-item-section side>
                    <div class="row q-gutter-sm">
                      <q-btn
                        flat
                        dense
                        icon="restore"
                        color="primary"
                        @click="restoreVersion(version)"
                      >
                        <q-tooltip>Restore as new project</q-tooltip>
                      </q-btn>
                      <q-btn
                        flat
                        dense
                        icon="download"
                        color="secondary"
                        @click="exportVersion(version)"
                      >
                        <q-tooltip>Export version as JSON</q-tooltip>
                      </q-btn>
                      <q-btn
                        flat
                        dense
                        icon="delete"
                        color="negative"
                        @click="deleteVersion(version)"
                      >
                        <q-tooltip>Delete version</q-tooltip>
                      </q-btn>
                    </div>
                  </q-item-section>
                </q-item>
              </q-list>
            </div>
          </q-tab-panel>
        </q-tab-panels>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Close" @click="closeDialog" />
      </q-card-actions>
    </q-card>

    <!-- Save Version Dialog -->
    <q-dialog v-model="showSaveVersionDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">Save Version</div>
        </q-card-section>

        <q-card-section>
          <q-input
            v-model="versionName"
            label="Version Name (optional)"
            hint="Leave empty to use timestamp"
            autofocus
            @keyup.enter="saveVersionManually"
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="showSaveVersionDialog = false" />
          <q-btn flat label="Save" color="primary" @click="saveVersionManually" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useOutlineStore } from 'stores/outline-store'
import { storeToRefs } from 'pinia'
import { useQuasar } from 'quasar'
import { getStorageAdapter } from 'src/utils/storage/index.js'
import { getMediaAdapter } from 'src/utils/media/index.js'
import { extractRefHashesFromHtml } from 'src/utils/media/references.js'
import { downloadJSON as downloadJSONShared } from 'src/utils/export/json.js'
import {
  isUserFolderApiAvailable,
  pickUserFolder,
  loadUserFolderHandle,
  clearUserFolderHandle,
  ensureUserFolderPermission,
} from 'src/utils/media/userfolder-adapter.js'
import { isOpfsAvailable } from 'src/utils/media/opfs-adapter.js'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue'])

const $q = useQuasar()
const store = useOutlineStore()
const {
  currentProject,
  fontScale,
  indentSize,
  showIndentGuides,
  defaultListType,
  tibetanFontFamily,
  tibetanFontSize,
  tibetanFontColor,
  nonTibetanFontFamily,
  nonTibetanFontSize,
  nonTibetanFontColor,
  mediaBackend,
  mediaUsage,
} = storeToRefs(store)

const showDialog = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const SETTINGS_ACTIVE_TAB_KEY = 'scaffold-settings-active-tab'
const activeTab = ref('project')
const showSaveVersionDialog = ref(false)
const versionName = ref('')

// Program settings
const programSettings = ref({
  autoVersioning: [],
  versioningInterval: 10,
  defaultFontSize: 14,
  defaultIndentSize: 32,
  defaultTibetanFontFamily: 'Microsoft Himalaya',
  defaultTibetanFontSize: 20,
  defaultTibetanFontColor: '#000000',
  defaultNonTibetanFontFamily: 'Aptos, sans-serif',
  defaultNonTibetanFontSize: 16,
  defaultNonTibetanFontColor: '#000000',
})

// Project settings are now accessed directly through store refs

// Versions list
const versions = ref([])

const autoVersioningOptions = [
  { label: 'On program start', value: 'start' },
  { label: 'On program close', value: 'close' },
  { label: 'At regular intervals', value: 'interval' },
]

const fontFamilyOptions = [
  { label: 'Microsoft Himalaya', value: 'Microsoft Himalaya' },
  { label: 'Noto Sans Tibetan', value: 'Noto Sans Tibetan' },
  { label: 'Jomolhari', value: 'Jomolhari' },
  { label: 'Aptos, sans-serif', value: 'Aptos, sans-serif' },
  { label: 'Arial, sans-serif', value: 'Arial, sans-serif' },
  { label: 'Times New Roman, serif', value: 'Times New Roman, serif' },
]

const fontSizeOptions = Array.from({ length: 37 }, (_, i) => {
  const size = i + 12
  return { label: `${size}px`, value: size }
})

const projectMediaUsage = ref({ imageBytes: 0, audioBytes: 0 })

// Media storage backend UI state
const userFolderApiAvailable = ref(false)
const opfsApiAvailable = ref(false)
const userFolderConfigured = ref(false)
const userFolderPermissionState = ref(null)
const isPickingFolder = ref(false)

const mediaBackendLabel = computed(() => {
  switch (mediaBackend.value) {
    case 'userfolder+idb':
      return 'User-picked folder (with IndexedDB fallback)'
    case 'opfs+idb':
      return 'Origin Private File System (with IndexedDB fallback)'
    case 'idb':
      return 'IndexedDB (browser-managed)'
    default:
      return mediaBackend.value || 'Unknown'
  }
})

async function refreshMediaBackendState() {
  userFolderApiAvailable.value = isUserFolderApiAvailable()
  opfsApiAvailable.value = isOpfsAvailable()
  if (!userFolderApiAvailable.value) {
    userFolderConfigured.value = false
    userFolderPermissionState.value = null
    return
  }
  try {
    const handle = await loadUserFolderHandle()
    userFolderConfigured.value = !!handle
    userFolderPermissionState.value = handle
      ? await ensureUserFolderPermission(handle, { interactive: false })
      : null
  } catch (error) {
    console.warn('Failed to inspect user-folder handle:', error)
    userFolderConfigured.value = false
    userFolderPermissionState.value = null
  }
}

async function chooseMediaFolder() {
  if (!userFolderApiAvailable.value) return
  isPickingFolder.value = true
  try {
    await pickUserFolder()
    await store.reselectMediaBackend()
    await refreshMediaBackendState()
    $q.notify({
      type: 'positive',
      message: 'Media folder set. New uploads will be saved there.',
      position: 'top',
      timeout: 3000,
    })
  } catch (error) {
    if (error?.name === 'AbortError') return
    console.warn('Failed to choose media folder:', error)
    $q.notify({
      type: 'negative',
      message: error?.message || 'Could not set the media folder.',
      position: 'top',
      timeout: 4000,
    })
  } finally {
    isPickingFolder.value = false
  }
}

async function disconnectMediaFolder() {
  try {
    await clearUserFolderHandle()
    await store.reselectMediaBackend()
    await refreshMediaBackendState()
    $q.notify({
      type: 'info',
      message: 'Media folder disconnected. Reverting to default storage.',
      position: 'top',
      timeout: 3000,
    })
  } catch (error) {
    console.warn('Failed to disconnect media folder:', error)
    $q.notify({
      type: 'negative',
      message: 'Could not disconnect the media folder.',
      position: 'top',
      timeout: 4000,
    })
  }
}

const projectStorageUsage = computed(() => {
  if (!currentProject.value) {
    return {
      totalBytes: 0,
      mediaBytes: 0,
      imageBytes: 0,
      audioBytes: 0,
    }
  }

  // Project metadata size (text, settings, structure) reported separately
  // from media. The media bytes come from the content-addressable media
  // adapter, which excludes the bulk that used to inflate this number
  // when long-note HTML carried inline data: URIs.
  const totalBytes =
    getUtf8Bytes(JSON.stringify(currentProject.value)) +
    projectMediaUsage.value.imageBytes +
    projectMediaUsage.value.audioBytes

  return {
    totalBytes,
    mediaBytes: projectMediaUsage.value.imageBytes + projectMediaUsage.value.audioBytes,
    imageBytes: projectMediaUsage.value.imageBytes,
    audioBytes: projectMediaUsage.value.audioBytes,
  }
})

/**
 * Walk the current project's long-note HTML, collect every
 * `scaffold-media://` reference along with whether it appears in an
 * `<img>` or `<audio>` element, then resolve each unique hash against
 * the media adapter to retrieve its stored size.
 *
 * Bytes are reported per-project (sum across distinct hashes), so the
 * same hash referenced twice in one project does not double-count.
 */
async function refreshProjectMediaUsage() {
  if (!currentProject.value) {
    projectMediaUsage.value = { imageBytes: 0, audioBytes: 0 }
    return
  }

  const imageHashes = new Set()
  const audioHashes = new Set()

  function walk(items) {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (Array.isArray(item.longNotes)) {
        for (const note of item.longNotes) {
          if (typeof note?.text !== 'string') continue
          const refs = extractRefHashesFromHtml(note.text)
          if (refs.length === 0) continue
          // Inspect the actual element to classify image vs audio.
          const doc = new DOMParser().parseFromString(note.text, 'text/html')
          const imgs = doc.querySelectorAll('img[src^="scaffold-media://"]')
          const audios = doc.querySelectorAll('audio[src^="scaffold-media://"]')
          imgs.forEach((el) => {
            const hash = (el.getAttribute('src') || '').slice('scaffold-media://'.length)
            if (hash) imageHashes.add(hash)
          })
          audios.forEach((el) => {
            const hash = (el.getAttribute('src') || '').slice('scaffold-media://'.length)
            if (hash) audioHashes.add(hash)
          })
        }
      }
      if (Array.isArray(item.children) && item.children.length > 0) {
        walk(item.children)
      }
    }
  }

  walk(currentProject.value.lists || [])

  const adapter = getMediaAdapter()
  let imageBytes = 0
  let audioBytes = 0
  for (const hash of imageHashes) {
    const row = await adapter.get(hash)
    if (row?.size) imageBytes += row.size
  }
  for (const hash of audioHashes) {
    const row = await adapter.get(hash)
    if (row?.size) audioBytes += row.size
  }
  projectMediaUsage.value = { imageBytes, audioBytes }
}

function getUtf8Bytes(value) {
  if (!value) return 0
  return new TextEncoder().encode(value).length
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function persistProgramSettings() {
  return getStorageAdapter().setMeta('program-settings', JSON.stringify(programSettings.value))
}

onMounted(async () => {
  loadActiveTab()
  await loadProgramSettings()
  await loadVersions()
  await refreshProjectMediaUsage()
  await refreshMediaBackendState()
})

watch(currentProject, async () => {
  await loadVersions()
  await refreshProjectMediaUsage()
})

// When the dialog opens, recompute media usage so it reflects any
// uploads/deletes that happened while the dialog was closed.
watch(showDialog, async (visible) => {
  if (visible) {
    await refreshProjectMediaUsage()
    await refreshMediaBackendState()
  }
})

async function loadProgramSettings() {
  const saved = await getStorageAdapter().getMeta('program-settings')
  if (saved) {
    programSettings.value = {
      ...programSettings.value,
      ...JSON.parse(saved),
    }
  }
}

function loadActiveTab() {
  const savedTab = localStorage.getItem(SETTINGS_ACTIVE_TAB_KEY)
  if (savedTab === 'program' || savedTab === 'project') {
    activeTab.value = savedTab
  } else {
    activeTab.value = 'project'
  }
}

async function loadVersions() {
  if (!currentProject.value) {
    versions.value = []
    return
  }

  const adapter = getStorageAdapter()
  const entries = await adapter.getMetaEntries(`scaffold-version-${currentProject.value.id}-`)

  versions.value = entries
    .map((entry) => {
      try {
        return JSON.parse(entry.value)
      } catch {
        return null
      }
    })
    .filter((v) => v !== null)
    .sort((a, b) => b.timestamp - a.timestamp)
}

function saveVersionManually() {
  if (!currentProject.value) return

  const versionId = store.saveVersion(versionName.value || null, 'manual')

  showSaveVersionDialog.value = false
  versionName.value = ''
  loadVersions()

  if (versionId) {
    $q.notify({
      type: 'positive',
      message: 'Version saved successfully',
      position: 'top',
      timeout: 2000,
    })
  } else {
    $q.notify({
      type: 'info',
      message: 'No changes since last version - nothing to save',
      position: 'top',
      timeout: 2000,
    })
  }
}

function restoreVersion(version) {
  $q.dialog({
    title: 'Restore Version',
    message: `This will create a new project from the version "${version.name || formatDate(version.timestamp)}". Continue?`,
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    const restoredProjectId = await store.restoreVersion(version)
    if (restoredProjectId) {
      $q.notify({
        type: 'positive',
        message: 'Version restored as new project',
        position: 'top',
        timeout: 2000,
      })
      closeDialog()
    }
  })
}

async function exportVersion(version) {
  if (!version.data) return

  // Create filename with version info
  const versionDate = new Date(version.timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  const timestamp = `${versionDate.getFullYear()}-${pad(versionDate.getMonth() + 1)}-${pad(versionDate.getDate())}_${pad(versionDate.getHours())}:${pad(versionDate.getMinutes())}:${pad(versionDate.getSeconds())}`
  const projectName = currentProject.value?.name || 'project'
  const versionName = version.name ? `_${version.name.replace(/[^a-z0-9]/gi, '_')}` : ''
  const filename = `${projectName.replace(/[^a-z0-9]/gi, '_')}_version_${timestamp}${versionName}`

  await downloadJSONShared(version.data, filename)

  $q.notify({
    type: 'positive',
    message: 'Version exported successfully',
    position: 'top',
    timeout: 2000,
  })
}

function deleteVersion(version) {
  $q.dialog({
    title: 'Delete Version',
    message: `Are you sure you want to delete this version?`,
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    const key = `scaffold-version-${currentProject.value.id}-${version.id}`
    await getStorageAdapter().deleteMeta(key)
    await loadVersions()
    $q.notify({
      type: 'positive',
      message: 'Version deleted',
      position: 'top',
      timeout: 2000,
    })
  })
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString()
}

function closeDialog() {
  persistProgramSettings()
  localStorage.setItem(SETTINGS_ACTIVE_TAB_KEY, activeTab.value)
  showDialog.value = false
}

watch(activeTab, (tab) => {
  localStorage.setItem(SETTINGS_ACTIVE_TAB_KEY, tab)
})
</script>

<style scoped>
.typography-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.family-field {
  width: 200px;
  max-width: 200px;
}

.size-field {
  width: 120px;
}

.color-swatch {
  width: 34px;
  min-width: 34px;
  height: 34px;
  border: 1px solid #bdbdbd;
  border-radius: 6px;
  padding: 0;
}
</style>
