<template>
  <q-dialog v-model="showDialog" maximized>
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
          </q-tab-panel>

          <!-- Project Settings Tab -->
          <q-tab-panel name="project">
            <div class="text-h6 q-mb-md">Settings for: {{ currentProject?.name }}</div>

            <div class="q-mb-lg">
              <div class="text-subtitle1 q-mb-sm">Display Settings</div>
              <div class="row q-col-gutter-md">
                <div class="col-12 col-md-6">
                  <q-slider
                    v-model="projectSettings.fontSize"
                    :min="12"
                    :max="40"
                    :step="1"
                    label
                    label-always
                    :label-value="'Front Size: ' + projectSettings.fontSize + 'px'"
                    @change="updateProjectSettings"
                  />
                </div>
                <div class="col-12 col-md-6">
                  <q-slider
                    v-model="projectSettings.indentSize"
                    :min="5"
                    :max="50"
                    :step="1"
                    label
                    label-always
                    :label-value="'Indent Size: ' + projectSettings.indentSize + 'px'"
                    @change="updateProjectSettings"
                  />
                </div>
              </div>

              <q-checkbox
                v-model="projectSettings.showIndentGuides"
                label="Show indent guides"
                @update:model-value="updateProjectSettings"
              />
            </div>

            <q-separator class="q-my-md" />

            <div class="q-mb-lg">
              <div class="text-subtitle1 q-mb-sm">Default List Type</div>
              <q-radio
                v-model="projectSettings.defaultListType"
                val="ordered"
                label="Numbered (1, 2, 3)"
                @update:model-value="updateProjectSettings"
              />
              <q-radio
                v-model="projectSettings.defaultListType"
                val="unordered"
                label="Bulleted (•)"
                @update:model-value="updateProjectSettings"
              />
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

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue'])

const $q = useQuasar()
const store = useOutlineStore()
const { currentProject, fontSize, indentSize, showIndentGuides, defaultListType } =
  storeToRefs(store)

const showDialog = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const activeTab = ref('program')
const showSaveVersionDialog = ref(false)
const versionName = ref('')

// Program settings
const programSettings = ref({
  autoVersioning: [],
  versioningInterval: 10,
  defaultFontSize: 14,
  defaultIndentSize: 32,
})

// Project settings (reactive copy)
const projectSettings = ref({
  fontSize: 14,
  indentSize: 32,
  showIndentGuides: true,
  defaultListType: 'ordered',
})

// Versions list
const versions = ref([])

const autoVersioningOptions = [
  { label: 'On program start', value: 'start' },
  { label: 'On program close', value: 'close' },
  { label: 'At regular intervals', value: 'interval' },
]

onMounted(() => {
  loadProgramSettings()
  loadProjectSettings()
  loadVersions()
})

watch(currentProject, () => {
  loadProjectSettings()
  loadVersions()
})

function loadProgramSettings() {
  const saved = localStorage.getItem('scaffold-program-settings')
  if (saved) {
    programSettings.value = JSON.parse(saved)
  }
}

function loadProjectSettings() {
  if (currentProject.value) {
    projectSettings.value = {
      fontSize: fontSize.value,
      indentSize: indentSize.value,
      showIndentGuides: showIndentGuides.value,
      defaultListType: defaultListType.value,
    }
  }
}

function updateProjectSettings() {
  store.setFontSize(projectSettings.value.fontSize)
  store.setIndentSize(projectSettings.value.indentSize)
  store.setShowIndentGuides(projectSettings.value.showIndentGuides)
  store.setDefaultListType(projectSettings.value.defaultListType)
}

function loadVersions() {
  if (!currentProject.value) {
    versions.value = []
    return
  }

  const versionKeys = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(`scaffold-version-${currentProject.value.id}-`)) {
      versionKeys.push(key)
    }
  }

  versions.value = versionKeys
    .map((key) => {
      const data = localStorage.getItem(key)
      if (data) {
        try {
          return JSON.parse(data)
        } catch {
          return null
        }
      }
      return null
    })
    .filter((v) => v !== null)
    .sort((a, b) => b.timestamp - a.timestamp)
}

function saveVersionManually() {
  if (!currentProject.value) return

  store.saveVersion(versionName.value || null, 'manual')

  showSaveVersionDialog.value = false
  versionName.value = ''
  loadVersions()

  $q.notify({
    type: 'positive',
    message: 'Version saved successfully',
    position: 'top',
    timeout: 2000,
  })
}

function restoreVersion(version) {
  $q.dialog({
    title: 'Restore Version',
    message: `This will create a new project from the version "${version.name || formatDate(version.timestamp)}". Continue?`,
    cancel: true,
    persistent: true,
  }).onOk(() => {
    const restoredProjectId = store.restoreVersion(version)
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

function exportVersion(version) {
  if (!version.data) return

  // Create filename with version info
  const timestamp = new Date(version.timestamp).toISOString().split('T')[0]
  const projectName = currentProject.value?.name || 'project'
  const versionName = version.name ? `_${version.name.replace(/[^a-z0-9]/gi, '_')}` : ''
  const filename = `${projectName.replace(/[^a-z0-9]/gi, '_')}_version_${timestamp}${versionName}`

  // Use the same download function as the main JSON export
  downloadJSON(version.data, filename)

  $q.notify({
    type: 'positive',
    message: 'Version exported successfully',
    position: 'top',
    timeout: 2000,
  })
}

function downloadJSON(data, filename) {
  const jsonString = JSON.stringify(data, null, 2)
  const blob = new Blob([jsonString], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename.replace(/[^a-z0-9]/gi, '_')}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function deleteVersion(version) {
  $q.dialog({
    title: 'Delete Version',
    message: `Are you sure you want to delete this version?`,
    cancel: true,
    persistent: true,
  }).onOk(() => {
    const key = `scaffold-version-${currentProject.value.id}-${version.id}`
    localStorage.removeItem(key)
    loadVersions()
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
  // Save program settings
  localStorage.setItem('scaffold-program-settings', JSON.stringify(programSettings.value))
  showDialog.value = false
}
</script>
