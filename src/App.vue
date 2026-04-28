<template>
  <div v-if="!storeReady || switchingContext" class="fullscreen row justify-center items-center">
    <q-spinner size="48px" color="primary" />
  </div>
  <router-view v-else />
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useOutlineStore } from 'stores/outline-store'
import { storeToRefs } from 'pinia'

const store = useOutlineStore()
const { longNoteEditorActive, storeReady, switchingContext } = storeToRefs(store)

function handleKeyDown(event) {
  if (longNoteEditorActive.value) {
    return
  }

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const ctrlKey = isMac ? event.metaKey : event.ctrlKey
  
  if (ctrlKey && event.key === 'z' && !event.shiftKey) {
    event.preventDefault()
    store.undo()
  } else if (ctrlKey && (event.key === 'y' || (event.key === 'z' && event.shiftKey))) {
    event.preventDefault()
    store.redo()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
})
</script>
