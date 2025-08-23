<template>
  <div class="outline-editor q-pa-md">
    <div v-if="currentProject" class="full-width">
      <div class="row items-center q-mb-md">
        <div class="col">
          <div class="text-h5">{{ currentProject.name }}</div>
        </div>
        <q-btn
          round
          dense
          flat
          icon="add"
          color="primary"
          @click="addRootItem"
        >
          <q-tooltip>Add Root Item</q-tooltip>
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
import { useOutlineStore } from 'stores/outline-store'
import { storeToRefs } from 'pinia'
import OutlineItem from './OutlineItem.vue'

const store = useOutlineStore()
const { currentProject } = storeToRefs(store)

function addRootItem() {
  store.addRootListItem()
}
</script>

<style scoped>
.outline-editor {
  height: 100%;
  overflow-y: auto;
}

.outline-items {
  max-width: 900px;
  margin: 0 auto;
}
</style>