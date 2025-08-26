<template>
  <div class="outline-item" :class="{ 'is-root': isRoot }" :data-item-id="item.id">
    <div class="item-content" :style="{ fontSize: fontSize + 'px' }">
      <div class="item-main">
        <div class="item-controls-left">
          <q-btn
            v-if="item.children && item.children.length > 0"
            round
            dense
            flat
            size="xs"
            style="width: 24px"
            :icon="item.collapsed ? 'chevron_right' : 'expand_more'"
            @click="toggleCollapse"
          />
          <div v-else class="spacer"></div>
        </div>

        <div class="item-text-container">
          <div class="item-prefix ordered" v-if="listType === 'ordered'">{{ index + 1 }}.</div>
          <div class="item-prefix unordered" v-else>•</div>

          <div
            v-if="!isEditing"
            class="item-text-display"
            :style="{ fontSize: fontSize + 'px' }"
            @click="startEditing"
          >
            {{ item.text || 'Click to edit...' }}
          </div>
          <q-input
            v-else
            :model-value="item.text"
            dense
            borderless
            class="item-text-input"
            :style="{ fontSize: fontSize + 'px' }"
            autofocus
            @update:model-value="updateText"
            @keydown.enter.prevent="handleEnter"
            @keydown.tab.prevent="handleTab"
            @keydown.shift.tab.prevent="handleShiftTab"
            @keydown.esc="stopEditing"
            @blur="stopEditing"
          />

          <span v-for="note in item.shortNotes" :key="note.id" class="short-note">
            <span class="short-note-text" @click.stop="editShortNote(note)">
              {{ note.text }}
            </span>
            <q-btn
              round
              dense
              flat
              size="xs"
              icon="close"
              class="short-note-delete"
              @click="deleteShortNote(note.id)"
            />
          </span>
        </div>

        <div class="item-controls-right">
          <q-btn round dense flat size="xs" icon="note_add">
            <q-tooltip>Add Note</q-tooltip>
            <q-menu>
              <q-list dense>
                <q-item clickable v-close-popup @click="addShortNote">
                  <q-item-section>Add Short Note</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="addLongNote">
                  <q-item-section>Add Long Note</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>

          <q-btn round dense flat size="xs" icon="add" @click="addChild">
            <q-tooltip>Add Child</q-tooltip>
          </q-btn>

          <q-btn round dense flat size="xs" icon="more_vert">
            <q-menu>
              <q-list dense>
                <q-item clickable v-close-popup @click="addSibling">
                  <q-item-section>Add Sibling</q-item-section>
                </q-item>
                <q-item
                  v-if="item.children && item.children.length > 0"
                  clickable
                  v-close-popup
                  @click="toggleChildrenListType"
                >
                  <q-item-section>
                    <div class="row items-center">
                      <q-icon
                        :name="
                          item.childrenType === 'ordered'
                            ? 'format_list_numbered'
                            : 'format_list_bulleted'
                        "
                        size="xs"
                        class="q-mr-xs"
                      />
                      Toggle Children Type
                    </div>
                  </q-item-section>
                </q-item>
                <q-separator />
                <q-item clickable v-close-popup @click="moveUp" :disable="index === 0">
                  <q-item-section>Move Up</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="moveDown">
                  <q-item-section>Move Down</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="indent" :disable="isRoot || index === 0">
                  <q-item-section>Indent</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="outdent" :disable="isRoot">
                  <q-item-section>Outdent</q-item-section>
                </q-item>
                <q-separator />
                <q-item clickable v-close-popup @click="deleteItem">
                  <q-item-section class="text-negative">Delete</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>
      </div>

      <div
        v-if="item.longNotes && item.longNotes.length > 0"
        class="long-notes"
        :style="{ marginLeft: 64 - 30 + fontSize + 'px' /* a hack to align with oultline text */ }"
      >
        <div v-for="note in item.longNotes" :key="note.id" v-show="!note.hidden" class="long-note">
          <div class="long-note-header" @click="toggleLongNote(note.id)">
            <q-btn
              round
              dense
              flat
              size="xs"
              :icon="note.collapsed ? 'chevron_right' : 'expand_more'"
              @click.stop="toggleLongNote(note.id)"
            />
            <span v-if="note.collapsed" class="long-note-preview">
              {{ stripHtml(note.text) }}...
            </span>
            <q-space />
            <q-btn round dense flat size="xs" icon="edit" @click.stop="editLongNote(note)" />
            <q-btn round dense flat size="xs" icon="close" @click.stop="deleteLongNote(note.id)" />
          </div>
          <div v-if="!note.collapsed" class="long-note-content">
            <div v-html="formatText(note.text)"></div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="!item.collapsed && item.children && item.children.length > 0"
      class="item-children"
      :class="{ 'with-guide': showIndentGuides }"
      :style="{ marginLeft: indentSize + 'px' }"
    >
      <OutlineItem
        v-for="(child, childIndex) in item.children"
        :key="child.id"
        :item="child"
        :index="childIndex"
        :isRoot="false"
        :listType="item.childrenType"
      />
    </div>

    <q-dialog v-model="showShortNoteDialog">
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">{{ editingNote ? 'Edit' : 'Add' }} Short Note</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="noteText"
            label="Note (e.g., p. 23-45)"
            autofocus
            @keyup.enter="saveShortNote"
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            flat
            label="Save"
            color="primary"
            :disable="!noteText.trim()"
            @click="saveShortNote"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showLongNoteDialog" maximized>
      <q-card>
        <q-card-section class="row items-center">
          <div class="text-h6">{{ editingNote ? 'Edit' : 'Add' }} Long Note</div>
          <q-space />
          <div v-if="isAutosaving" class="text-caption text-primary q-mr-sm">
            <q-spinner-dots size="16px" class="q-mr-xs" />
            Autosaving...
          </div>
          <div v-else-if="lastAutosaved" class="text-caption text-grey q-mr-sm">
            <q-icon name="check_circle" size="16px" class="q-mr-xs" />
            Saved
          </div>
          <q-btn icon="close" flat round dense @click="closeLongNoteDialog" />
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-editor
            ref="longNoteEditor"
            v-model="noteText"
            min-height="300px"
            :definitions="{
              removeBreaks: {
                label: 'Remove \\n',
                tip: 'Remove line breaks from selection',
                handler: stripLineBreaks,
              },
            }"
            :toolbar="[
              ['bold', 'italic', 'underline'],
              ['unordered', 'ordered', 'outdent', 'indent'],
              ['quote', 'code', 'code_block'],
              ['link', 'image', 'fullscreen'],
              ['undo', 'redo'],
              ['upload', 'save'],
              ['removeBreaks'],
            ]"
            @keydown="handleEditorKeydown"
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="closeLongNoteDialog" />
          <q-btn flat label="Save" color="primary" @click="saveLongNote" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useOutlineStore } from 'stores/outline-store'
import { storeToRefs } from 'pinia'

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  index: {
    type: Number,
    required: true,
  },
  isRoot: {
    type: Boolean,
    default: false,
  },
  listType: {
    type: String,
    default: 'unordered',
  },
})

const store = useOutlineStore()
const { fontSize, indentSize, showIndentGuides, currentlyEditingId } = storeToRefs(store)

const showShortNoteDialog = ref(false)
const showLongNoteDialog = ref(false)
const noteText = ref('')
const editingNote = ref(null)
const isEditing = computed(() => currentlyEditingId.value === props.item.id)
const longNoteEditor = ref(null)

// Autosave state
const autosaveTimer = ref(null)
const isAutosaving = ref(false)
const lastAutosaved = ref(null)

// Watch for long note dialog state changes to update global state
watch(showLongNoteDialog, (isOpen) => {
  store.setLongNoteEditorActive(isOpen)
})

function toggleCollapse() {
  store.updateListItem(props.item.id, { collapsed: !props.item.collapsed })
}

function toggleChildrenListType() {
  store.toggleChildrenListType(props.item.id)
}

function updateText(value) {
  store.updateListItem(props.item.id, { text: value })
}

function startEditing() {
  store.setEditingItem(props.item.id)
}

function stopEditing() {
  store.setEditingItem(null)
}

function handleEnter() {
  stopEditing()
  addSibling()
}

function handleTab() {
  store.navigateToNextSibling(props.item.id)
}

function handleShiftTab() {
  store.navigateToNextItem(props.item.id)
}

function addChild() {
  store.addChildItem(props.item.id)
}

function addSibling() {
  if (props.isRoot) {
    store.addRootListItem()
  } else {
    store.addChildItem(props.item.parentId)
  }
}

function moveUp() {
  store.moveItem(props.item.id, 'up')
}

function moveDown() {
  store.moveItem(props.item.id, 'down')
}

function indent() {
  store.indentItem(props.item.id)
}

function outdent() {
  store.outdentItem(props.item.id)
}

function deleteItem() {
  store.deleteListItem(props.item.id)
}

function addShortNote() {
  editingNote.value = null
  noteText.value = ''
  showShortNoteDialog.value = true
}

function editShortNote(note) {
  editingNote.value = note
  noteText.value = note.text
  showShortNoteDialog.value = true
}

function saveShortNote() {
  if (noteText.value.trim()) {
    if (editingNote.value) {
      store.updateNote(props.item.id, editingNote.value.id, 'short', noteText.value.trim())
    } else {
      store.addShortNote(props.item.id, noteText.value.trim())
    }
    showShortNoteDialog.value = false
    noteText.value = ''
    editingNote.value = null
  }
}

function deleteShortNote(noteId) {
  store.deleteNote(props.item.id, noteId, 'short')
}

function addLongNote() {
  editingNote.value = null
  noteText.value = ''
  showLongNoteDialog.value = true
}

function editLongNote(note) {
  editingNote.value = note
  noteText.value = note.text
  showLongNoteDialog.value = true
}

function saveLongNote() {
  if (noteText.value.trim()) {
    if (editingNote.value) {
      store.updateNote(props.item.id, editingNote.value.id, 'long', noteText.value.trim())
    } else {
      const newNoteId = store.addLongNote(props.item.id, noteText.value.trim())
      // Update editingNote so subsequent saves update instead of creating new
      if (newNoteId) {
        editingNote.value = props.item.longNotes.find((n) => n.id === newNoteId)
      }
    }
    lastAutosaved.value = new Date()
  }
  closeLongNoteDialog()
}

function autosaveLongNote() {
  if (!noteText.value.trim() || !showLongNoteDialog.value) return

  isAutosaving.value = true

  if (editingNote.value) {
    store.updateNote(props.item.id, editingNote.value.id, 'long', noteText.value.trim())
  } else {
    // For new notes, create and track them
    const newNoteId = store.addLongNote(props.item.id, noteText.value.trim())
    // Find the newly created note from the item's longNotes array
    editingNote.value = props.item.longNotes.find((n) => n.id === newNoteId)
  }

  lastAutosaved.value = new Date()

  // Clear autosaving indicator after a short delay
  setTimeout(() => {
    isAutosaving.value = false
  }, 500)
}

// Watch for changes to noteText and trigger autosave
watch(noteText, (newValue) => {
  if (!showLongNoteDialog.value) return

  // Clear existing timer
  if (autosaveTimer.value) {
    clearTimeout(autosaveTimer.value)
  }

  // Only autosave if there's content
  if (newValue.trim()) {
    autosaveTimer.value = setTimeout(() => {
      autosaveLongNote()
    }, 2000) // Autosave after 2 seconds of inactivity
  }
})

function closeLongNoteDialog() {
  // Clear any pending autosave
  if (autosaveTimer.value) {
    clearTimeout(autosaveTimer.value)
    autosaveTimer.value = null
  }

  showLongNoteDialog.value = false
  noteText.value = ''
  editingNote.value = null
  lastAutosaved.value = null
  isAutosaving.value = false
}

function deleteLongNote(noteId) {
  store.deleteNote(props.item.id, noteId, 'long')
}

function toggleLongNote(noteId) {
  store.toggleNoteCollapse(props.item.id, noteId)
}

function formatText(text) {
  return text
    .replace(/<b>/g, '<strong>')
    .replace(/<\/b>/g, '</strong>')
    .replace(/<i>/g, '<em>')
    .replace(/<\/i>/g, '</em>')
    .replace(/<u>/g, '<span style="text-decoration: underline;">')
    .replace(/<\/u>/g, '</span>')
}

function stripHtml(text) {
  const tmp = document.createElement('div')
  tmp.innerHTML = text
  return tmp.textContent || tmp.innerText || ''
}

function handleEditorKeydown(event) {
  // Handle Tab key for indent
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault()
    // Execute indent command in the editor
    if (longNoteEditor.value) {
      longNoteEditor.value.runCmd('indent')
    }
  }
  // Handle Shift+Tab for outdent
  else if (event.key === 'Tab' && event.shiftKey) {
    event.preventDefault()
    // Execute outdent command in the editor
    if (longNoteEditor.value) {
      longNoteEditor.value.runCmd('outdent')
    }
  }
}

function stripLineBreaks() {
  if (!longNoteEditor.value) return

  // Get the current HTML content
  const currentHtml = noteText.value
  
  // Get the selection or use all text
  const selection = window.getSelection()
  const selectedText = selection.toString()
  
  if (selectedText) {
    // If there's a selection, replace it with cleaned version
    const cleanedText = selectedText
      .replace(/\r\n|\r|\n/g, ' ') // Replace line breaks with space
      .replace(/<br\s*\/?>/gi, ' ') // Replace HTML breaks
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim() // Remove leading/trailing whitespace
    
    // Use the editor's built-in method to replace selection
    document.execCommand('insertText', false, cleanedText)
  } else {
    // If no selection, clean the entire content
    // Create a temporary div to parse HTML
    const temp = document.createElement('div')
    temp.innerHTML = currentHtml
    
    // Get text content and clean it
    const textContent = temp.innerText || temp.textContent || ''
    const cleanedText = textContent
      .replace(/\r\n|\r|\n/g, ' ') // Replace line breaks with space
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim() // Remove leading/trailing whitespace
    
    // Update the editor content
    noteText.value = `<p>${cleanedText}</p>`
  }
}

/*
function handleLongNotePaste(event) {
  event.preventDefault()

  // Get the pasted text from clipboard
  const pastedText = (event.clipboardData || window.clipboardData).getData('text')

  // Strip line breaks and replace with spaces
  //const cleanedText = pastedText.replace(/[\r\n]+/g, ' ').trim()

  // Insert the cleaned text at cursor position
  document.execCommand('insertText', false, pastedText)
}
  */
</script>

<style scoped>
.outline-item {
  margin-bottom: 4px;
}

.item-content {
  background: white;
  border-radius: 4px;
  padding: 4px 8px;
}

.item-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-controls-left {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.spacer {
  width: 24px;
}

.item-text-container {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-prefix {
  font-weight: 500;
  color: #666;
  flex-shrink: 0;
  font-size: inherit;
  align-self: flex-start;
  padding-top: 8px;
}

.item-prefix.ordered {
  font-size: 80%;
}

.item-text-display {
  flex: 1;
  cursor: text;
  padding: 2px 4px;
  border-radius: 2px;
  line-height: 1.5;
  word-wrap: break-word;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  min-height: 1.5em;
  transition: background-color 0.2s;
}

.item-text-display:hover {
  background-color: rgba(0, 0, 0, 0.02);
}

.item-text-display:empty::before {
  content: 'Click to edit...';
  color: #999;
  font-style: italic;
}

.item-text-input {
  flex: 1;
}

.item-text-input :deep(input) {
  font-size: inherit !important;
  padding: 2px 4px !important;
}

.short-note {
  font-style: italic;
  color: #666;
  font-size: 0.6em;
  margin-left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.short-note-text {
  cursor: pointer;
}

.short-note-text:hover {
  text-decoration: underline;
}

.short-note-delete {
  opacity: 0;
  transition: opacity 0.2s;
}

.short-note:hover .short-note-delete {
  opacity: 1;
}

.item-controls-right {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.long-notes {
  margin-top: 8px;
}

.long-note {
  background: #f5f5f5;
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 4px;
}

.long-note-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.long-note-label {
  font-weight: 500;
  color: #666;
  font-size: 0.9em;
}

.long-note-preview {
  flex: 1;
  color: #666;
  font-size: 0.7em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.long-note-content {
  margin-top: 8px;
  font-size: 0.7em;
  margin: 4px;
}

.item-children {
  margin-top: 4px;
}

.item-children.with-guide {
  border-left: 2px solid rgb(151, 201, 245);
}

.is-root > .item-content {
  border-left: 3px solid #1976d2;
}
</style>
