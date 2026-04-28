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

              <q-separator class="q-my-md" />

              <div class="text-subtitle2 q-mb-sm">S3-compatible storage (optional)</div>
              <div class="text-caption text-grey-8 q-mb-sm">
                Sync media to your own S3 bucket (AWS, Cloudflare R2, MinIO,
                Backblaze B2, etc.). When connected, uploads go to the bucket
                first and the local cache (OPFS or IndexedDB) is used for fast
                reads. Configure CORS on the bucket to allow GET, HEAD, PUT,
                and DELETE from this site.
              </div>

              <div v-if="s3ConfigState.configured && !s3ConfigState.unlocked" class="q-mb-md">
                <q-banner dense class="bg-amber-1 text-amber-10 q-mb-sm">
                  S3 is configured but locked. Enter your passphrase to use it
                  this session.
                </q-banner>
                <div class="row q-gutter-sm items-end">
                  <q-input
                    v-model="s3UnlockPassphrase"
                    type="password"
                    label="Passphrase"
                    outlined
                    dense
                    style="max-width: 320px"
                    @keyup.enter="unlockS3Settings"
                  />
                  <q-btn color="primary" label="Unlock" @click="unlockS3Settings" />
                  <q-btn
                    flat
                    color="negative"
                    label="Disconnect"
                    @click="disconnectS3Settings"
                  />
                </div>
              </div>

              <div
                v-else-if="s3ConfigState.configured && s3ConfigState.unlocked"
                class="q-mb-md"
              >
                <div class="row items-center q-gutter-sm">
                  <q-icon name="cloud_done" color="positive" />
                  <span class="text-body2">
                    Connected to <strong>{{ s3Form.bucket }}</strong> at
                    <span class="text-caption">{{ s3Form.endpoint }}</span>
                    ({{ s3ConfigState.mode === 'persisted' ? 'remembered' : 'session' }}<span
                      v-if="s3ConfigState.sharedBucket"
                    >, shared bucket</span
                    >)
                  </span>
                  <q-space />
                  <q-btn
                    v-if="s3ConfigState.mode === 'persisted'"
                    flat
                    dense
                    color="grey-8"
                    label="Lock"
                    @click="lockS3Settings"
                  />
                  <q-btn
                    flat
                    dense
                    color="negative"
                    label="Disconnect"
                    @click="disconnectS3Settings"
                  />
                </div>

                <q-banner
                  v-if="programUnsyncedHashes.size > 0"
                  rounded
                  dense
                  class="bg-amber-1 text-amber-10 q-mt-sm"
                >
                  <template v-slot:avatar>
                    <q-icon name="cloud_upload" color="warning" />
                  </template>
                  <div class="text-body2">
                    <strong>{{ programUnsyncedHashes.size }}</strong> media
                    file{{ programUnsyncedHashes.size === 1 ? '' : 's' }} on
                    this device {{ programUnsyncedHashes.size === 1 ? 'is' : 'are' }}
                    not yet on your S3 bucket. This usually happens when S3 is
                    connected after media has already been uploaded locally —
                    new uploads write through, but existing media stays put
                    until pushed.
                  </div>
                  <div
                    v-if="isBackfillingProgram && backfillProgress"
                    class="text-caption q-mt-xs"
                  >
                    Pushing {{ backfillProgress.uploaded }} / {{ backfillProgress.total }}…
                  </div>
                  <template v-slot:action>
                    <q-btn
                      flat
                      color="primary"
                      label="Push all to S3"
                      :loading="isBackfillingProgram"
                      @click="backfillAllToS3"
                    />
                  </template>
                </q-banner>
              </div>

              <q-expansion-item
                v-else
                label="Configure S3-compatible storage"
                icon="cloud_upload"
                dense
              >
                <q-card flat>
                  <q-card-section class="q-pa-sm">
                    <div class="row q-col-gutter-sm">
                      <q-input
                        v-model="s3Form.endpoint"
                        label="Endpoint"
                        placeholder="https://s3.us-east-1.amazonaws.com"
                        outlined
                        dense
                        class="col-12 col-md-6"
                      />
                      <q-input
                        v-model="s3Form.region"
                        label="Region"
                        outlined
                        dense
                        class="col-6 col-md-3"
                      />
                      <q-input
                        v-model="s3Form.bucket"
                        label="Bucket"
                        outlined
                        dense
                        class="col-6 col-md-3"
                      />
                      <q-input
                        v-model="s3Form.prefix"
                        label="Object key prefix"
                        outlined
                        dense
                        class="col-12 col-md-6"
                      />
                      <div class="col-12 col-md-6 row items-center">
                        <q-checkbox
                          v-model="s3Form.pathStyle"
                          label="Use path-style URLs (recommended for non-AWS)"
                        />
                      </div>
                      <div class="col-12 row items-start">
                        <q-checkbox
                          v-model="s3Form.sharedBucket"
                          label="Shared bucket (multiple devices write here)"
                        >
                          <q-tooltip max-width="320px">
                            Keep automated cleanup on this device from
                            deleting media that other devices may still
                            reference. You can still purge bytes
                            explicitly when deleting a project.
                          </q-tooltip>
                        </q-checkbox>
                      </div>
                      <q-input
                        v-model="s3Form.accessKeyId"
                        label="Access key ID"
                        outlined
                        dense
                        class="col-12 col-md-6"
                      />
                      <q-input
                        v-model="s3Form.secretAccessKey"
                        type="password"
                        label="Secret access key"
                        outlined
                        dense
                        class="col-12 col-md-6"
                      />
                      <div class="col-12">
                        <q-option-group
                          v-model="s3Form.mode"
                          :options="s3Modes"
                          type="radio"
                          inline
                        />
                      </div>
                      <q-input
                        v-if="s3Form.mode === 'persisted'"
                        v-model="s3Form.passphrase"
                        type="password"
                        label="Encryption passphrase"
                        outlined
                        dense
                        class="col-12 col-md-6"
                      />
                      <q-input
                        v-if="s3Form.mode === 'persisted'"
                        v-model="s3Form.passphraseConfirm"
                        type="password"
                        label="Confirm passphrase"
                        outlined
                        dense
                        class="col-12 col-md-6"
                      />
                    </div>
                    <div class="row q-mt-sm">
                      <q-space />
                      <q-btn
                        color="primary"
                        label="Connect"
                        :loading="isSavingS3"
                        :disable="!s3FormValid()"
                        @click="saveS3Settings"
                      />
                    </div>
                  </q-card-section>
                </q-card>
              </q-expansion-item>
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

            <q-banner
              v-if="currentProject && projectUnsyncedHashes.size > 0"
              rounded
              class="bg-amber-1 text-amber-10 q-mb-lg"
            >
              <template v-slot:avatar>
                <q-icon name="cloud_off" color="warning" />
              </template>
              <div class="text-subtitle2">Media not yet on S3</div>
              <div class="text-body2">
                <strong>{{ projectUnsyncedHashes.size }}</strong> media
                file{{ projectUnsyncedHashes.size === 1 ? ' is' : 's are' }}
                stored locally on this device but not yet uploaded to your
                S3 bucket. Other devices pointing at the same bucket
                won't be able to render
                {{ projectUnsyncedHashes.size === 1 ? 'it' : 'them' }}.
              </div>
              <div
                v-if="isBackfillingProject && backfillProgress"
                class="text-caption q-mt-xs"
              >
                Pushing {{ backfillProgress.uploaded }} / {{ backfillProgress.total }}…
              </div>
              <template v-slot:action>
                <q-btn
                  flat
                  color="primary"
                  label="Push to S3"
                  :loading="isBackfillingProject"
                  @click="backfillProjectToS3"
                />
              </template>
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
import {
  saveS3Config,
  loadS3Config,
  clearS3Config,
  unlockS3Config,
  lockS3Config,
  setS3SessionCredentials,
  getS3Credentials,
} from 'src/utils/media/s3-config.js'

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

// Media sync status (only meaningful on s3+ backends).
const projectUnsyncedHashes = ref(new Set())
const programUnsyncedHashes = ref(new Set())
const isBackfillingProject = ref(false)
const isBackfillingProgram = ref(false)
const backfillProgress = ref(null)

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

// --- S3-compatible storage state ---------------------------------------------

const s3Form = ref({
  endpoint: '',
  region: 'us-east-1',
  bucket: '',
  prefix: 'scaffold/media',
  pathStyle: true,
  sharedBucket: false,
  accessKeyId: '',
  secretAccessKey: '',
  passphrase: '',
  passphraseConfirm: '',
  mode: 'session',
})
const s3UnlockPassphrase = ref('')
const s3ConfigState = ref({
  configured: false,
  mode: null,
  unlocked: false,
  sharedBucket: false,
})
const isSavingS3 = ref(false)

const s3Modes = [
  {
    label: 'Session only — paste secret each session (recommended for shared devices)',
    value: 'session',
  },
  {
    label: 'Remember on this device — encrypted with a passphrase you set',
    value: 'persisted',
  },
]

async function refreshS3State() {
  try {
    const stored = await loadS3Config()
    if (!stored?.publicConfig) {
      s3ConfigState.value = { configured: false, mode: null, unlocked: false, sharedBucket: false }
      return
    }
    const credentials = getS3Credentials()
    s3ConfigState.value = {
      configured: true,
      mode: stored.publicConfig.mode,
      unlocked: !!credentials?.secretAccessKey,
      sharedBucket: Boolean(stored.publicConfig.sharedBucket),
    }
    s3Form.value = {
      ...s3Form.value,
      endpoint: stored.publicConfig.endpoint || '',
      region: stored.publicConfig.region || 'us-east-1',
      bucket: stored.publicConfig.bucket || '',
      prefix: stored.publicConfig.prefix || 'scaffold/media',
      pathStyle: stored.publicConfig.pathStyle !== false,
      sharedBucket: Boolean(stored.publicConfig.sharedBucket),
      accessKeyId: stored.publicConfig.accessKeyId || '',
      mode: stored.publicConfig.mode || 'session',
      secretAccessKey: '',
      passphrase: '',
      passphraseConfirm: '',
    }
  } catch (error) {
    console.warn('Failed to read S3 config:', error)
  }
}

function s3FormValid() {
  if (!s3Form.value.endpoint || !s3Form.value.region || !s3Form.value.bucket) return false
  if (!s3Form.value.accessKeyId || !s3Form.value.secretAccessKey) return false
  if (s3Form.value.mode === 'persisted') {
    if (!s3Form.value.passphrase || s3Form.value.passphrase !== s3Form.value.passphraseConfirm) {
      return false
    }
  }
  return true
}

async function saveS3Settings() {
  if (!s3FormValid()) {
    $q.notify({
      type: 'warning',
      message:
        s3Form.value.mode === 'persisted' && s3Form.value.passphrase !== s3Form.value.passphraseConfirm
          ? 'Passphrases do not match.'
          : 'Please fill out every field before connecting.',
      position: 'top',
      timeout: 3000,
    })
    return
  }
  isSavingS3.value = true
  try {
    const publicConfig = {
      endpoint: s3Form.value.endpoint.trim(),
      region: s3Form.value.region.trim(),
      bucket: s3Form.value.bucket.trim(),
      prefix: s3Form.value.prefix.trim() || 'scaffold/media',
      pathStyle: s3Form.value.pathStyle,
      sharedBucket: s3Form.value.sharedBucket,
      accessKeyId: s3Form.value.accessKeyId.trim(),
      mode: s3Form.value.mode,
    }
    if (s3Form.value.mode === 'persisted') {
      await saveS3Config(publicConfig, {
        secretAccessKey: s3Form.value.secretAccessKey,
        passphrase: s3Form.value.passphrase,
      })
    } else {
      await setS3SessionCredentials(publicConfig, s3Form.value.secretAccessKey)
    }
    await store.reselectMediaBackend()
    await refreshS3State()
    await refreshMediaBackendState()
    await refreshMediaSyncStatus()
    $q.notify({
      type: 'positive',
      message: 'S3 storage connected. Media will sync to your bucket.',
      position: 'top',
      timeout: 3000,
    })
  } catch (error) {
    console.warn('Failed to save S3 config:', error)
    $q.notify({
      type: 'negative',
      message: error?.message || 'Could not connect to S3.',
      position: 'top',
      timeout: 4000,
    })
  } finally {
    isSavingS3.value = false
  }
}

async function unlockS3Settings() {
  if (!s3UnlockPassphrase.value) return
  const credentials = await unlockS3Config(s3UnlockPassphrase.value)
  if (!credentials) {
    $q.notify({
      type: 'negative',
      message: 'Wrong passphrase.',
      position: 'top',
      timeout: 3000,
    })
    return
  }
  s3UnlockPassphrase.value = ''
  await store.reselectMediaBackend()
  await refreshS3State()
  await refreshMediaBackendState()
  await refreshMediaSyncStatus()
  $q.notify({
    type: 'positive',
    message: 'S3 vault unlocked.',
    position: 'top',
    timeout: 2000,
  })
}

async function lockS3Settings() {
  lockS3Config()
  await refreshS3State()
  await store.reselectMediaBackend()
  await refreshMediaBackendState()
  await refreshMediaSyncStatus()
}

async function disconnectS3Settings() {
  try {
    await clearS3Config()
    await store.reselectMediaBackend()
    await refreshS3State()
    await refreshMediaBackendState()
    await refreshMediaSyncStatus()
    $q.notify({
      type: 'info',
      message: 'S3 storage disconnected.',
      position: 'top',
      timeout: 3000,
    })
  } catch (error) {
    console.warn('Failed to disconnect S3:', error)
    $q.notify({
      type: 'negative',
      message: 'Could not disconnect S3.',
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
/**
 * Recompute "media held locally but not pushed to S3" for the current
 * project and the whole device. No-op on local-only backends.
 */
async function refreshMediaSyncStatus() {
  if (!store.mediaBackendSupportsRemoteSync()) {
    projectUnsyncedHashes.value = new Set()
    programUnsyncedHashes.value = new Set()
    return
  }
  try {
    const [perProject, allUnsynced] = await Promise.all([
      currentProject.value
        ? store.getUnsyncedMediaForProject(currentProject.value.id)
        : Promise.resolve(new Set()),
      store.getAllUnsyncedMedia(),
    ])
    projectUnsyncedHashes.value = perProject
    programUnsyncedHashes.value = allUnsynced
  } catch (error) {
    console.warn('Failed to compute media sync status:', error)
    projectUnsyncedHashes.value = new Set()
    programUnsyncedHashes.value = new Set()
  }
}

async function backfillProjectToS3() {
  if (!currentProject.value) return
  if (projectUnsyncedHashes.value.size === 0) return
  isBackfillingProject.value = true
  backfillProgress.value = { uploaded: 0, total: projectUnsyncedHashes.value.size }
  try {
    const stats = await store.backfillMediaToRemote(projectUnsyncedHashes.value, {
      onProgress: ({ uploaded, total }) => {
        backfillProgress.value = { uploaded, total }
      },
    })
    if (stats.failed > 0) {
      $q.notify({
        type: 'warning',
        message: `Pushed ${stats.uploaded} file(s); ${stats.failed} failed.`,
        position: 'top',
        timeout: 4000,
      })
    } else {
      $q.notify({
        type: 'positive',
        message: `Pushed ${stats.uploaded} media file(s) to S3.`,
        position: 'top',
        timeout: 3000,
      })
    }
    await refreshMediaSyncStatus()
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: `Push to S3 failed: ${error.message}`,
      position: 'top',
      timeout: 4000,
    })
  } finally {
    isBackfillingProject.value = false
    backfillProgress.value = null
  }
}

async function backfillAllToS3() {
  if (programUnsyncedHashes.value.size === 0) return
  isBackfillingProgram.value = true
  backfillProgress.value = { uploaded: 0, total: programUnsyncedHashes.value.size }
  try {
    const stats = await store.backfillMediaToRemote(programUnsyncedHashes.value, {
      onProgress: ({ uploaded, total }) => {
        backfillProgress.value = { uploaded, total }
      },
    })
    if (stats.failed > 0) {
      $q.notify({
        type: 'warning',
        message: `Pushed ${stats.uploaded} file(s); ${stats.failed} failed.`,
        position: 'top',
        timeout: 4000,
      })
    } else {
      $q.notify({
        type: 'positive',
        message: `Pushed ${stats.uploaded} media file(s) to S3.`,
        position: 'top',
        timeout: 3000,
      })
    }
    await refreshMediaSyncStatus()
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: `Push to S3 failed: ${error.message}`,
      position: 'top',
      timeout: 4000,
    })
  } finally {
    isBackfillingProgram.value = false
    backfillProgress.value = null
  }
}

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
  await refreshS3State()
  await refreshMediaSyncStatus()
})

watch(currentProject, async () => {
  await loadVersions()
  await refreshProjectMediaUsage()
  await refreshMediaSyncStatus()
})

// When the dialog opens, recompute media usage so it reflects any
// uploads/deletes that happened while the dialog was closed.
watch(showDialog, async (visible) => {
  if (visible) {
    await refreshProjectMediaUsage()
    await refreshMediaBackendState()
    await refreshS3State()
    await refreshMediaSyncStatus()
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
