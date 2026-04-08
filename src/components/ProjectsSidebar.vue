<template>
  <q-drawer
    v-model="drawerOpen"
    show-if-above
    :width="250"
    :breakpoint="500"
    bordered
    class="bg-grey-2"
  >
    <q-scroll-area class="fit">
      <div class="q-pa-md">
        <div class="row items-center q-mb-md">
          <div class="col text-h6">Projects</div>
          <q-btn round dense flat icon="download" size="sm" @click="exportAllProjects">
            <q-tooltip>Export All Projects</q-tooltip>
          </q-btn>
          <q-btn round dense flat icon="add" size="sm" @click="showNewProjectDialog = true">
            <q-tooltip>New Project</q-tooltip>
          </q-btn>
        </div>

        <div class="q-mb-md">
          <div class="text-caption text-grey-8 q-mb-xs">Font Scale</div>
          <div class="row items-center q-gutter-xs">
            <q-btn
              round
              dense
              flat
              icon="remove"
              size="sm"
              :disable="fontScale <= 50"
              @click="decreaseFontScale"
            />
            <div class="text-body2" style="min-width: 40px; text-align: center">
              {{ fontScale }}%
            </div>
            <q-btn
              round
              dense
              flat
              icon="add"
              size="sm"
              :disable="fontScale >= 200"
              @click="increaseFontScale"
            />
            <q-slider
              v-model="fontScale"
              :min="50"
              :max="200"
              :step="1"
              color="primary"
              class="col q-ml-sm"
              @update:model-value="updateFontScale"
            />
          </div>
        </div>

        <div class="q-mb-md">
          <div class="text-caption text-grey-8 q-mb-xs">Indent Size</div>
          <div class="row items-center q-gutter-xs">
            <q-btn
              round
              dense
              flat
              icon="remove"
              size="sm"
              :disable="indentSize <= 5"
              @click="decreaseIndentSize"
            />
            <div class="text-body2" style="min-width: 40px; text-align: center">
              {{ indentSize }}px
            </div>
            <q-btn
              round
              dense
              flat
              icon="add"
              size="sm"
              :disable="indentSize >= 50"
              @click="increaseIndentSize"
            />
            <q-slider
              v-model="indentSize"
              :min="5"
              :max="50"
              :step="1"
              color="primary"
              class="col q-ml-sm"
              @update:model-value="updateIndentSize"
            />
          </div>
        </div>

        <div class="q-mb-md">
          <div class="text-caption text-grey-8 q-mb-xs">Default List Type</div>
          <q-select
            v-model="defaultListType"
            :options="listTypeOptions"
            dense
            outlined
            emit-value
            map-options
            @update:model-value="updateDefaultListType"
          />
        </div>

        <div class="q-mb-md">
          <q-toggle
            v-model="showIndentGuides"
            label="Show Indent Guides"
            color="primary"
            @update:model-value="updateShowIndentGuides"
          />
        </div>

        <q-list>
          <q-item
            v-for="project in projects"
            :key="project.id"
            clickable
            v-ripple
            :active="project.id === currentProjectId"
            active-class="bg-primary text-white"
            :class="{ 'project-row-locked': isProjectLockedRow(project.id) }"
            @click="onProjectRowClick(project.id)"
            class="q-mb-xs rounded-borders"
          >
            <q-item-section v-if="editingProjectId !== project.id">
              <q-item-label>{{ project.name }}</q-item-label>
              <q-item-label caption>
                {{ formatDate(project.updatedAt) }}
              </q-item-label>
            </q-item-section>

            <q-item-section v-else>
              <q-input
                v-model="editingProjectName"
                dense
                autofocus
                @keyup.enter="saveProjectName"
                @keyup.esc="cancelEditProjectName"
                @blur="saveProjectName"
              />
            </q-item-section>

            <q-item-section side v-if="editingProjectId !== project.id">
              <div class="text-grey-8 q-gutter-xs">
                <q-btn
                  size="12px"
                  flat
                  dense
                  round
                  icon="edit"
                  @click.stop="startEditProjectName(project)"
                >
                  <q-tooltip>Rename</q-tooltip>
                </q-btn>
                <q-btn
                  size="12px"
                  flat
                  dense
                  round
                  icon="delete"
                  @click.stop="confirmDeleteProject(project)"
                >
                  <q-tooltip>Delete</q-tooltip>
                </q-btn>
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </div>
    </q-scroll-area>

    <q-dialog v-model="showNewProjectDialog">
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">New Project</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="newProjectName"
            label="Project Name"
            autofocus
            @keyup.enter="createNewProject"
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            flat
            label="Create"
            color="primary"
            :disable="!newProjectName.trim()"
            @click="createNewProject"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showDeleteDialog">
      <q-card>
        <q-card-section>
          <div class="text-h6">Delete Project</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          Are you sure you want to delete "{{ projectToDelete?.name }}"? This action cannot be
          undone.
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn flat label="Delete" color="negative" @click="deleteSelectedProject" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-drawer>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useOutlineStore } from 'stores/outline-store'
import { storeToRefs } from 'pinia'
import { useQuasar } from 'quasar'
import { isProjectLockStorageKey } from 'src/utils/project-tab-lock'

const store = useOutlineStore()
const $q = useQuasar()
const {
  projects,
  currentProjectId,
  fontScale,
  indentSize,
  defaultListType,
  showIndentGuides,
} = storeToRefs(store)

const drawerOpen = ref(true)
const showNewProjectDialog = ref(false)
const newProjectName = ref('')
const showDeleteDialog = ref(false)
const projectToDelete = ref(null)
const editingProjectId = ref(null)
const editingProjectName = ref('')

/** Bumped on cross-tab lock storage changes so lock state re-evaluates in template. */
const lockTick = ref(0)
let lockPollTimer = null

function refreshProjectLockState() {
  lockTick.value += 1
}

function isProjectLockedRow(projectId) {
  lockTick.value
  return store.isProjectLockHeldByOtherTab(projectId)
}

function showProjectLockedDialog() {
  $q.dialog({
    title: 'Project open elsewhere',
    message:
      'This project is already open in another tab or window in this browser. Close it there or wait until it becomes inactive before opening it here.',
    ok: {
      label: 'OK',
      color: 'primary',
    },
  })
}

function onProjectRowClick(projectId) {
  if (store.isProjectLockHeldByOtherTab(projectId)) {
    showProjectLockedDialog()
    return
  }
  const ok = store.selectProject(projectId)
  if (!ok) {
    showProjectLockedDialog()
  }
}

function onStorageForLocks(event) {
  if (event.key && isProjectLockStorageKey(event.key)) {
    refreshProjectLockState()
  }
}

onMounted(() => {
  window.addEventListener('storage', onStorageForLocks)
  window.addEventListener('focus', refreshProjectLockState)
  lockPollTimer = window.setInterval(refreshProjectLockState, 5000)
})

onUnmounted(() => {
  window.removeEventListener('storage', onStorageForLocks)
  window.removeEventListener('focus', refreshProjectLockState)
  if (lockPollTimer !== null) {
    clearInterval(lockPollTimer)
    lockPollTimer = null
  }
})

const listTypeOptions = [
  { label: 'Numbered (1, 2, 3)', value: 'ordered' },
  { label: 'Bulleted (•)', value: 'unordered' }
]

function createNewProject() {
  if (newProjectName.value.trim()) {
    const project = store.createProject(newProjectName.value.trim())
    store.selectProject(project.id)
    refreshProjectLockState()
    newProjectName.value = ''
    showNewProjectDialog.value = false
  }
}

function confirmDeleteProject(project) {
  projectToDelete.value = project
  showDeleteDialog.value = true
}

function deleteSelectedProject() {
  if (projectToDelete.value) {
    store.deleteProject(projectToDelete.value.id)
    projectToDelete.value = null
    showDeleteDialog.value = false
  }
}

function startEditProjectName(project) {
  editingProjectId.value = project.id
  editingProjectName.value = project.name
}

function saveProjectName() {
  if (editingProjectName.value.trim() && editingProjectId.value) {
    store.renameProject(editingProjectId.value, editingProjectName.value.trim())
  }
  cancelEditProjectName()
}

function cancelEditProjectName() {
  editingProjectId.value = null
  editingProjectName.value = ''
}

function formatDate(dateString) {
  const date = new Date(dateString)
  const now = new Date()
  const diffTime = Math.abs(now - date)
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60))
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffTime / (1000 * 60))
      return diffMinutes === 0 ? 'Just now' : `${diffMinutes}m ago`
    }
    return `${diffHours}h ago`
  } else if (diffDays === 1) {
    return 'Yesterday'
  } else if (diffDays < 7) {
    return `${diffDays} days ago`
  } else {
    return date.toLocaleDateString()
  }
}

function increaseFontScale() {
  if (fontScale.value < 200) {
    store.setFontScale(fontScale.value + 1)
  }
}

function decreaseFontScale() {
  if (fontScale.value > 50) {
    store.setFontScale(fontScale.value - 1)
  }
}

function updateFontScale(value) {
  store.setFontScale(value)
}

function increaseIndentSize() {
  if (indentSize.value < 50) {
    store.setIndentSize(indentSize.value + 1)
  }
}

function decreaseIndentSize() {
  if (indentSize.value > 5) {
    store.setIndentSize(indentSize.value - 1)
  }
}

function updateIndentSize(value) {
  store.setIndentSize(value)
}

function updateDefaultListType(value) {
  store.setDefaultListType(value)
}

function updateShowIndentGuides(value) {
  store.setShowIndentGuides(value)
}

function exportAllProjects() {
  store.exportAllAsJSON()
}

function toggleDrawer() {
  drawerOpen.value = !drawerOpen.value
}

defineExpose({
  toggleDrawer
})
</script>

<style scoped>
.project-row-locked {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
