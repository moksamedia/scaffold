<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated>
      <q-toolbar>
        <q-btn
          flat
          dense
          round
          icon="menu"
          aria-label="Toggle sidebar"
          @click="toggleSidebar"
        >
          <q-tooltip>Toggle Sidebar ({{ isMac ? 'Cmd' : 'Ctrl' }}+B)</q-tooltip>
        </q-btn>
        <q-toolbar-title>Outline Maker</q-toolbar-title>
      </q-toolbar>
    </q-header>

    <ProjectsSidebar ref="sidebarRef" />

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import ProjectsSidebar from 'components/ProjectsSidebar.vue'

const sidebarRef = ref(null)
const isMac = computed(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0)

function toggleSidebar() {
  sidebarRef.value?.toggleDrawer()
}

function handleKeyDown(event) {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const ctrlKey = isMac ? event.metaKey : event.ctrlKey
  
  // Ctrl/Cmd + B to toggle sidebar
  if (ctrlKey && event.key === 'b') {
    event.preventDefault()
    toggleSidebar()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
})
</script>
