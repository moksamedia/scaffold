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
        <q-toolbar-title>Scaffold</q-toolbar-title>
        <q-btn
          flat
          dense
          round
          icon="settings"
          aria-label="Settings"
          @click="showSettings = true"
        >
          <q-tooltip>Settings</q-tooltip>
        </q-btn>
      </q-toolbar>
    </q-header>

    <ProjectsSidebar ref="sidebarRef" />

    <q-page-container>
      <router-view />
    </q-page-container>
    
    <SettingsDialog v-model="showSettings" />
  </q-layout>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import ProjectsSidebar from 'components/ProjectsSidebar.vue'
import SettingsDialog from 'components/SettingsDialog.vue'

const sidebarRef = ref(null)
const showSettings = ref(false)
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
