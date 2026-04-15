<template>
  <div class="outline-editor q-pa-md">
    <div v-if="currentProject" class="full-width">
      <div class="row items-center q-mb-md">
        <div class="col">
          <div class="text-h5">{{ currentProject.name }}</div>
        </div>
        <q-btn round dense flat icon="undo" :disable="!canUndo" @click="undo">
          <q-tooltip>Undo ({{ isMac ? 'Cmd' : 'Ctrl' }}+Z)</q-tooltip>
        </q-btn>
        <q-btn round dense flat icon="redo" :disable="!canRedo" @click="redo">
          <q-tooltip>Redo ({{ isMac ? 'Cmd' : 'Ctrl' }}+{{ isMac ? 'Shift+Z' : 'Y' }})</q-tooltip>
        </q-btn>
        <q-separator vertical inset class="q-mx-sm" />
        <q-btn round dense flat icon="unfold_more">
          <q-tooltip>Collapse/Expand Items</q-tooltip>
          <q-menu>
            <q-list dense>
              <q-item clickable v-close-popup @click="collapseAllItems">
                <q-item-section>Collapse All Items</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="expandAllItems">
                <q-item-section>Expand All Items</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
        <q-btn round dense flat icon="speaker_notes">
          <q-tooltip>Collapse/Expand Notes</q-tooltip>
          <q-menu>
            <q-list dense>
              <q-item clickable v-close-popup @click="collapseAllNotes">
                <q-item-section>Collapse All Notes</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="expandAllNotes">
                <q-item-section>Expand All Notes</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
        <q-btn 
          round 
          dense 
          flat 
          :icon="allLongNotesVisible ? 'visibility' : 'visibility_off'"
          @click="toggleAllLongNotesVisibility"
        >
          <q-tooltip>{{ allLongNotesVisible ? 'Hide' : 'Show' }} All Long Notes</q-tooltip>
        </q-btn>
        <q-separator vertical inset class="q-mx-sm" />
        <q-btn
          round
          dense
          flat
          :icon="
            currentProject.rootListType === 'ordered'
              ? 'format_list_numbered'
              : 'format_list_bulleted'
          "
          @click="toggleRootListType"
        >
          <q-tooltip>Toggle Root List Type</q-tooltip>
        </q-btn>
        <q-btn round dense flat icon="add" color="primary" @click="addRootItem">
          <q-tooltip>Add Root Item</q-tooltip>
        </q-btn>
        <q-btn round dense flat icon="horizontal_rule" color="secondary" @click="addRootDivider">
          <q-tooltip>Add Root Divider</q-tooltip>
        </q-btn>
        <q-separator vertical inset class="q-mx-sm" />
        <q-btn round dense flat icon="download">
          <q-tooltip>Export</q-tooltip>
          <q-menu>
            <q-list dense>
              <q-item clickable v-close-popup @click="exportAsMarkdown">
                <q-item-section>Export as Markdown</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="exportAsDocx">
                <q-item-section>Export as Word Document</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="exportAsJSON">
                <q-item-section>Export as JSON</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
        <q-btn round dense flat icon="bookmark" color="secondary" @click="showSaveVersionDialog = true">
          <q-tooltip>Save Version</q-tooltip>
        </q-btn>
      </div>

      <div v-if="currentProject.lists.length === 0" class="text-grey-6 q-pa-lg text-center">
        <q-icon name="article" size="64px" color="grey-4" />
        <div class="q-mt-md">No items yet. Click the + button to add your first item.</div>
      </div>

      <div v-else class="outline-items">
        <OutlineItem
          v-for="displayItem in rootDisplayItems"
          :key="displayItem.item.id"
          :item="displayItem.item"
          :index="displayItem.index"
          :isRoot="true"
          :listType="currentProject.rootListType"
        />
      </div>
    </div>

    <div v-else class="text-grey-6 q-pa-lg text-center">
      <q-icon name="folder_open" size="64px" color="grey-4" />
      <div class="q-mt-md">Select or create a project to get started</div>
    </div>

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
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useOutlineStore } from 'stores/outline-store'
import { storeToRefs } from 'pinia'
import { useQuasar } from 'quasar'
import OutlineItem from './OutlineItem.vue'

const store = useOutlineStore()
const { currentProject, canUndo, canRedo, allLongNotesVisible } = storeToRefs(store)
const $q = useQuasar()

const isMac = computed(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0)
const rootDisplayItems = computed(() => {
  if (!currentProject.value) return []

  let orderedIndex = 0
  return currentProject.value.lists.map((item) => {
    if (item.kind === 'divider') {
      orderedIndex = 0
      return { item, index: -1 }
    }

    if (currentProject.value.rootListType === 'ordered') {
      orderedIndex += 1
      return { item, index: orderedIndex - 1 }
    }

    return { item, index: 0 }
  })
})

// Save version dialog
const showSaveVersionDialog = ref(false)
const versionName = ref('')

function addRootItem() {
  store.addRootListItem()
}

function addRootDivider() {
  store.addRootDivider()
}

function toggleRootListType() {
  store.toggleRootListType()
}

function undo() {
  store.undo()
}

function redo() {
  store.redo()
}

function exportAsMarkdown() {
  store.exportAsMarkdown()
}

function exportAsDocx() {
  store.exportAsDocx()
}

function exportAsJSON() {
  store.exportAsJSON()
}

function collapseAllItems() {
  store.collapseExpandAllItems(true)
}

function expandAllItems() {
  store.collapseExpandAllItems(false)
}

function collapseAllNotes() {
  store.collapseExpandAllLongNotes(true)
}

function expandAllNotes() {
  store.collapseExpandAllLongNotes(false)
}

function toggleAllLongNotesVisibility() {
  store.showHideAllLongNotes(!allLongNotesVisible.value)
}

function saveVersionManually() {
  if (!currentProject.value) return
  
  const versionId = store.saveVersion(versionName.value || null, 'manual')
  
  showSaveVersionDialog.value = false
  versionName.value = ''
  
  if (versionId) {
    $q.notify({
      type: 'positive',
      message: 'Version saved successfully',
      position: 'top',
      timeout: 2000
    })
  } else {
    $q.notify({
      type: 'info',
      message: 'No changes since last version - nothing to save',
      position: 'top',
      timeout: 2000
    })
  }
}
</script>

<style scoped>
.outline-editor {
  height: 100%;
  overflow-y: auto;
}

.outline-items {
  margin: 0 5%;
}
@media (max-width: $breakpoint-xs-max) {
  .outline-items {
    margin: 0 1%;
  }
}
</style>
