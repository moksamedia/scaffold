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
            </q-list>
          </q-menu>
        </q-btn>
      </div>

      <div v-if="currentProject.lists.length === 0" class="text-grey-6 q-pa-lg text-center">
        <q-icon name="article" size="64px" color="grey-4" />
        <div class="q-mt-md">No items yet. Click the + button to add your first item.</div>
      </div>

      <div v-else class="outline-items">
        <OutlineItem
          v-for="(item, index) in currentProject.lists"
          :key="item.id"
          :item="item"
          :index="index"
          :isRoot="true"
          :listType="currentProject.rootListType"
        />
      </div>
    </div>

    <div v-else class="text-grey-6 q-pa-lg text-center">
      <q-icon name="folder_open" size="64px" color="grey-4" />
      <div class="q-mt-md">Select or create a project to get started</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useOutlineStore } from 'stores/outline-store'
import { storeToRefs } from 'pinia'
import OutlineItem from './OutlineItem.vue'

const store = useOutlineStore()
const { currentProject, canUndo, canRedo } = storeToRefs(store)

const isMac = computed(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0)

function addRootItem() {
  store.addRootListItem()
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
