<template>
  <div class="outline-item" :class="{ 'is-root': isRoot }" :data-item-id="item.id">
    <div v-if="isDivider" class="root-divider-block">
      <div class="root-divider-line" />
      <div class="item-controls-right">
        <q-btn round dense flat size="xs" icon="add" @click="addSibling">
          <q-tooltip>Add Item After Divider</q-tooltip>
        </q-btn>
        <q-btn round dense flat size="xs" icon="more_vert">
          <q-menu>
            <q-list dense>
              <q-item clickable v-close-popup @click="moveUp" :disable="positionIndex === 0">
                <q-item-section>Move Up</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="moveDown">
                <q-item-section>Move Down</q-item-section>
              </q-item>
              <q-separator />
              <q-item clickable v-close-popup @click="deleteItem">
                <q-item-section class="text-negative">Delete Divider</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </div>
    </div>

    <div v-else class="item-content" :style="{ fontSize: scaledUiFontSize + 'px' }">
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
          <div class="item-prefix ordered" v-if="listType === 'ordered' && index >= 0">{{ index + 1 }}.</div>
          <div class="item-prefix unordered" v-else-if="index >= 0">•</div>

          <div v-if="!isEditing" class="item-text-display" @click="startEditing">
            <template v-if="item.text">
              <span
                v-for="(run, runIndex) in splitScriptRuns(item.text)"
                :key="`item-${item.id}-run-${runIndex}`"
                :style="getRunStyle(run.type)"
              >
                {{ run.text }}
              </span>
            </template>
            <span v-else class="placeholder-text">Click to edit...</span>
          </div>
          <q-input
            v-else
            :model-value="item.text"
            dense
            borderless
            class="item-text-input"
            :style="{ fontSize: scaledUiFontSize + 'px' }"
            autofocus
            @update:model-value="updateText"
            @paste="onItemTextPaste"
            @keydown.enter.prevent="handleEnter"
            @keydown.tab.prevent="handleTab"
            @keydown.shift.tab.prevent="handleShiftTab"
            @keydown.esc="stopEditing"
            @blur="stopEditing"
          />

          <span v-for="note in item.shortNotes" :key="note.id" class="short-note">
            <span class="short-note-text" @click.stop="editShortNote(note)">
              <span
                v-for="(run, runIndex) in splitScriptRuns(note.text)"
                :key="`short-${note.id}-run-${runIndex}`"
                :style="getRunStyle(run.type)"
              >
                {{ run.text }}
              </span>
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
                <q-item clickable v-close-popup @click="moveUp" :disable="positionIndex === 0">
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
        :style="{ marginLeft: 64 - 30 + scaledUiFontSize + 'px' /* a hack to align with oultline text */ }"
      >
        <div v-for="note in item.longNotes" :key="note.id" v-show="!note.hidden" class="long-note">
          <div
            class="long-note-header"
            @click="toggleLongNote(note.id)"
            @dblclick.stop="editLongNote(note)"
          >
            <q-btn
              round
              dense
              flat
              size="xs"
              :icon="note.collapsed ? 'chevron_right' : 'expand_more'"
              @click.stop="toggleLongNote(note.id)"
            />
            <span v-if="note.collapsed" class="long-note-preview" @dblclick.stop="editLongNote(note)">
              <span
                v-for="(run, runIndex) in splitScriptRuns(stripHtml(note.text))"
                :key="`preview-${note.id}-run-${runIndex}`"
                :style="getRunStyle(run.type)"
              >
                {{ run.text }}
              </span>
              ...
            </span>
            <q-space />
            <q-btn round dense flat size="xs" icon="edit" @click.stop="editLongNote(note)" />
            <q-btn round dense flat size="xs" icon="close" @click.stop="deleteLongNote(note.id)" />
          </div>
          <div v-if="!note.collapsed" class="long-note-content" @dblclick.stop="editLongNote(note)">
            <LongNoteRenderer :html="note.text" :get-run-style="getRunStyle" />
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="!isDivider && !item.collapsed && item.children && item.children.length > 0"
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
        <div class="long-note-dialog-wrap">
          <q-card-section class="row items-center">
            <div class="text-h6 long-note-dialog-title">
              {{ editingNote ? 'Edit Long Note' : 'Add Long Note' }} - {{ longNoteItemTitle }}
            </div>
            <q-space />
            <div class="row items-center q-gutter-xs q-mr-sm">
              <q-btn
                dense
                flat
                round
                icon="remove"
                :disable="noteEditorFontScale <= 50"
                @click="decreaseNoteEditorFontScale"
              />
              <div class="text-caption" style="min-width: 44px; text-align: center">
                {{ noteEditorFontScale }}%
              </div>
              <q-btn
                dense
                flat
                round
                icon="add"
                :disable="noteEditorFontScale >= 200"
                @click="increaseNoteEditorFontScale"
              />
            </div>
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
          <div v-if="storageSaveError || storageUsageWarning" class="q-px-md q-pb-sm">
            <q-banner
              dense
              rounded
              :class="storageSaveError ? 'bg-negative text-white' : 'bg-warning text-black'"
            >
              <template #avatar>
                <q-icon :name="storageSaveError ? 'error' : 'warning'" />
              </template>
              {{ storageSaveError || storageUsageWarning }}
            </q-banner>
          </div>

          <q-card-section class="q-pt-none">
            <q-editor
              ref="longNoteEditor"
              v-model="noteText"
              min-height="300px"
              :content-style="editorContentStyle"
              :definitions="{
                removeBreaks: {
                  label: 'Remove \\n',
                  tip: 'Remove line breaks from selection',
                  handler: stripLineBreaks,
                },
                insertImageUrl: {
                  icon: 'image',
                  tip: 'Insert image from URL',
                  handler: promptInsertImageUrl,
                },
                insertImageUpload: {
                  icon: 'upload',
                  tip: 'Upload image from your device',
                  handler: promptInsertImageUpload,
                },
                insertAudioUrl: {
                  icon: 'audiotrack',
                  tip: 'Upload audio from your device',
                  handler: promptInsertAudioUpload,
                },
                removeAudio: {
                  icon: 'delete',
                  tip: 'Remove selected audio',
                  handler: removeSelectedAudio,
                },
              }"
              :toolbar="[
                ['bold', 'italic', 'underline'],
                ['unordered', 'ordered', 'outdent', 'indent'],
                ['quote', 'code', 'code_block'],
                ['link', 'fullscreen'],
                ['insertImageUrl', 'insertImageUpload', 'insertAudioUrl', 'removeAudio'],
                ['undo', 'redo'],
                ['save'],
                ['removeBreaks'],
              ]"
              @click="handleEditorClick"
              @keydown="handleEditorKeydown"
            />
          </q-card-section>

          <q-card-actions align="right">
            <q-btn flat label="Cancel" @click="closeLongNoteDialog" />
            <q-btn flat label="Save" color="primary" @click="saveLongNote" />
          </q-card-actions>
        </div>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useQuasar } from 'quasar'
import { useOutlineStore, DEFAULT_NEW_LIST_ITEM_TEXT } from 'stores/outline-store'
import { storeToRefs } from 'pinia'
import { splitScriptRuns } from 'src/utils/text/script-runs'
import LongNoteRenderer from './LongNoteRenderer.vue'
import { ingestBlob, ingestDataUrl } from 'src/utils/media/ingest.js'
import { getMediaResolver } from 'src/utils/media/index.js'
import { logger } from 'src/utils/logging/logger.js'
import {
  buildMediaRef,
  normalizeHtmlToRefs,
  rewriteRefsWith,
} from 'src/utils/media/references.js'

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
const $q = useQuasar()
const {
  currentProject,
  fontSize,
  fontScale,
  indentSize,
  showIndentGuides,
  currentlyEditingId,
  tibetanFontFamily,
  tibetanFontSize,
  tibetanFontColor,
  nonTibetanFontFamily,
  nonTibetanFontSize,
  nonTibetanFontColor,
  storageSaveError,
  storageUsageWarning,
} = storeToRefs(store)

const scaleMultiplier = computed(() => (fontScale.value || 100) / 100)
const scaledUiFontSize = computed(() => Math.round((fontSize.value || 16) * scaleMultiplier.value))

const showShortNoteDialog = ref(false)
const showLongNoteDialog = ref(false)
const noteText = ref('')
const editingNote = ref(null)
const isEditing = computed(() => currentlyEditingId.value === props.item.id)
const isDivider = computed(() => props.item.kind === 'divider')
const positionIndex = computed(() => {
  if (!props.isRoot) return props.index
  const rootItems = currentProject.value?.lists || []
  return rootItems.findIndex((entry) => entry.id === props.item.id)
})
const longNoteItemTitle = computed(() => (props.item.text || 'Untitled Item').trim() || 'Untitled Item')
const longNoteEditor = ref(null)

// Autosave state
const autosaveTimer = ref(null)
const isAutosaving = ref(false)
const lastAutosaved = ref(null)
const NOTE_EDITOR_FONT_SCALE_KEY = 'scaffold-note-editor-font-scale'
const noteEditorFontScale = ref(100)
const MAX_IMAGE_UPLOAD_BYTES = 400 * 1024
const MAX_AUDIO_UPLOAD_BYTES = 30 * 1024 * 1024
const editorContentStyle = computed(() => ({
  fontSize: `${Math.round(16 * (noteEditorFontScale.value / 100))}px`,
  padding: '12px',
}))

// Watch for long note dialog state changes to update global state
watch(showLongNoteDialog, (isOpen) => {
  store.setLongNoteEditorActive(isOpen)
})

watch(
  isEditing,
  (editing) => {
    if (!editing || isDivider.value) return
    if (props.item.text === DEFAULT_NEW_LIST_ITEM_TEXT) {
      store.updateListItem(props.item.id, { text: '' })
    }
  },
  { flush: 'post' },
)

onMounted(() => {
  const savedScale = localStorage.getItem(NOTE_EDITOR_FONT_SCALE_KEY)
  if (!savedScale) return
  const parsed = parseInt(savedScale, 10)
  if (!Number.isNaN(parsed)) {
    noteEditorFontScale.value = Math.min(200, Math.max(50, parsed))
  }
})

watch(noteEditorFontScale, (value) => {
  localStorage.setItem(NOTE_EDITOR_FONT_SCALE_KEY, value.toString())
})

function toggleCollapse() {
  if (isDivider.value) return
  store.updateListItem(props.item.id, { collapsed: !props.item.collapsed })
}

function toggleChildrenListType() {
  if (isDivider.value) return
  store.toggleChildrenListType(props.item.id)
}

function updateText(value) {
  if (isDivider.value) return
  store.updateListItem(props.item.id, { text: value })
}

/** If paste contains line breaks, offer to split into sibling items (first line stays in this item). */
function onItemTextPaste(event) {
  if (isDivider.value) return
  const pasted = event.clipboardData?.getData('text/plain')
  if (pasted == null || !/\r|\n/.test(pasted)) return

  event.preventDefault()
  const lines = pasted.split(/\r\n|\r|\n/)
  if (lines.length < 2) return

  let inputEl = event.target
  if (inputEl && inputEl.tagName !== 'INPUT' && inputEl.tagName !== 'TEXTAREA') {
    inputEl = inputEl.closest?.('.q-field')?.querySelector('input, textarea') ?? null
  }
  const fullText = props.item.text ?? ''
  let start = 0
  let end = fullText.length
  if (inputEl && typeof inputEl.selectionStart === 'number') {
    start = inputEl.selectionStart
    end = inputEl.selectionEnd ?? start
  }
  const before = fullText.slice(0, start)
  const after = fullText.slice(end)
  const newItemCount = lines.length - 1

  $q.dialog({
    title: 'Multiple lines pasted',
    message: `Your paste includes line breaks. Create ${newItemCount} new sibling item(s) below this one? The first line stays in this item; each remaining line becomes its own item.`,
    cancel: {
      label: 'No, keep as one line',
      color: 'grey',
      flat: true,
    },
    ok: {
      label: `Create ${newItemCount} item(s)`,
      color: 'primary',
    },
    persistent: true,
  })
    .onOk(() => {
      const newCurrent = before + lines[0] + after
      store.applyMultiLinePasteAsSiblings(props.item.id, newCurrent, lines.slice(1))
    })
    .onCancel(() => {
      const singleLineInsert = pasted.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ')
      store.updateListItem(props.item.id, { text: before + singleLineInsert + after })
    })
}

function startEditing() {
  if (isDivider.value) return
  store.setEditingItem(props.item.id)
}

function stopEditing() {
  store.setEditingItem(null)
}

function handleEnter() {
  store.exitEditAndFocusNextSibling(props.item.id)
}

function handleTab() {
  store.navigateToNextSibling(props.item.id)
}

function handleShiftTab() {
  store.navigateToNextItem(props.item.id)
}

function addChild() {
  if (isDivider.value) return
  store.addChildItem(props.item.id)
}

function addSibling() {
  if (props.isRoot) {
    const newItem = store.addRootListItemAfter(props.item.id)
    if (newItem) {
      store.setEditingItem(newItem.id)
    }
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

async function deleteItem() {
  if (itemHasMeaningfulContent(props.item)) {
    const confirmed = window.confirm(
      'This list item contains content. Are you sure you want to delete it?',
    )
    if (!confirmed) return
    await saveVersionBeforeDelete()
  }
  store.deleteListItem(props.item.id)
}

function addShortNote() {
  if (isDivider.value) return
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

async function deleteShortNote(noteId) {
  const note = props.item.shortNotes.find((n) => n.id === noteId)
  if (note && hasMeaningfulText(note.text)) {
    const confirmed = window.confirm(
      'This note contains content. Are you sure you want to delete it?',
    )
    if (!confirmed) return
    await saveVersionBeforeDelete()
  }
  store.deleteNote(props.item.id, noteId, 'short')
}

async function expandRefsForEditor(html) {
  if (!html || typeof html !== 'string') return html || ''
  const resolver = getMediaResolver()
  const hashes = []
  for (const m of html.matchAll(/scaffold-media:\/\/([0-9a-f]{64})/g)) {
    hashes.push(m[1])
  }
  if (hashes.length > 0) {
    await resolver.ensureMany(hashes)
  }
  return rewriteRefsWith(html, (hash) => resolver.syncUrl(hash) || null, {
    tagWithHash: true,
  })
}

async function collapseRefsForStorage(html) {
  return normalizeHtmlToRefs(html, async (dataUrl) => {
    const { hash } = await ingestDataUrl(dataUrl)
    return hash
  })
}

function addLongNote() {
  if (isDivider.value) return
  editingNote.value = null
  noteText.value = ''
  showLongNoteDialog.value = true
}

async function editLongNote(note) {
  editingNote.value = note
  noteText.value = await expandRefsForEditor(note.text || '')
  showLongNoteDialog.value = true
}

async function saveLongNote() {
  const trimmed = noteText.value.trim()
  if (trimmed) {
    const normalized = (await collapseRefsForStorage(trimmed)).trim()
    if (editingNote.value) {
      store.updateNote(props.item.id, editingNote.value.id, 'long', normalized)
    } else {
      const newNoteId = store.addLongNote(props.item.id, normalized)
      // Track the new note so subsequent saves update instead of creating
      if (newNoteId) {
        editingNote.value = props.item.longNotes.find((n) => n.id === newNoteId)
      }
    }
    lastAutosaved.value = new Date()
  }
  closeLongNoteDialog()
}

async function autosaveLongNote() {
  if (!noteText.value.trim() || !showLongNoteDialog.value) return

  isAutosaving.value = true

  const normalized = (await collapseRefsForStorage(noteText.value.trim())).trim()

  if (editingNote.value) {
    store.updateNote(props.item.id, editingNote.value.id, 'long', normalized)
  } else {
    const newNoteId = store.addLongNote(props.item.id, normalized)
    editingNote.value = props.item.longNotes.find((n) => n.id === newNoteId)
  }

  lastAutosaved.value = new Date()

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

async function deleteLongNote(noteId) {
  const note = props.item.longNotes.find((n) => n.id === noteId)
  if (note && hasMeaningfulText(stripHtml(note.text))) {
    const confirmed = window.confirm(
      'This note contains content. Are you sure you want to delete it?',
    )
    if (!confirmed) return
    await saveVersionBeforeDelete()
  }
  store.deleteNote(props.item.id, noteId, 'long')
}

function toggleLongNote(noteId) {
  store.toggleNoteCollapse(props.item.id, noteId)
}

function hasMeaningfulText(text) {
  return Boolean((text || '').trim())
}

function itemHasMeaningfulContent(item) {
  if (hasMeaningfulText(item.text)) return true
  if ((item.shortNotes || []).some((note) => hasMeaningfulText(note.text))) return true
  if ((item.longNotes || []).some((note) => hasMeaningfulText(stripHtml(note.text)))) return true
  if ((item.children || []).some((child) => itemHasMeaningfulContent(child))) return true
  return false
}

async function saveVersionBeforeDelete() {
  try {
    await store.saveVersion(null, 'auto-delete')
  } catch (error) {
    logger.error('version.saveBeforeDelete.failed', error, {
      component: 'OutlineItem',
    })
  }
}

function escapeAttribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function normalizeHttpUrl(value) {
  const trimmed = (value || '').trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function insertHtmlAtCursor(html) {
  if (!longNoteEditor.value) return
  longNoteEditor.value.focus()
  document.execCommand('insertHTML', false, html)
}

function promptInsertImageUrl() {
  $q.dialog({
    title: 'Insert Image URL',
    message: 'Use an http(s) image URL.',
    prompt: {
      model: '',
      type: 'text',
      isValid: (value) => Boolean(normalizeHttpUrl(value)),
    },
    cancel: true,
    persistent: true,
  }).onOk((value) => {
    const mediaUrl = normalizeHttpUrl(value)
    if (!mediaUrl) return
    insertHtmlAtCursor(`<p><img src="${escapeAttribute(mediaUrl)}" alt="" /></p>`)
  })
}

async function ingestUploadedFile(file, mime) {
  const blob = file instanceof Blob ? file : null
  if (!blob) throw new Error('Invalid upload')
  const { hash } = await ingestBlob(blob, mime || file.type)
  const resolver = getMediaResolver()
  const blobUrl = await resolver.toObjectUrl(hash)
  return { hash, blobUrl: blobUrl || buildMediaRef(hash) }
}

function promptInsertAudioUpload() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return

    if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
      $q.notify({
        type: 'warning',
        message:
          'Large audio upload blocked (>30MB) to protect browser storage. Compress the file before embedding.',
      })
      return
    }

    try {
      const { hash, blobUrl } = await ingestUploadedFile(file, file.type || 'audio/mpeg')
      insertHtmlAtCursor(
        `<p class="embedded-audio-row"><audio controls src="${escapeAttribute(blobUrl)}" data-media-hash="${hash}">` +
          'Your browser does not support the audio element.' +
          '</audio><button type="button" class="remove-embedded-audio-btn" data-remove-audio="true" contenteditable="false" title="Remove audio" aria-label="Remove audio">✕</button></p>',
      )
    } catch (err) {
      logger.error('media.upload.audio.failed', err, {
        component: 'OutlineItem',
        sizeBytes: file.size,
        mime: file.type || null,
      })
      $q.notify({
        type: 'negative',
        message: 'Could not read the selected audio file.',
      })
    }
  }
  input.click()
}

function promptInsertImageUpload() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return

    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      $q.notify({
        type: 'warning',
        message:
          'Large image upload blocked to protect browser storage. Use an image URL or a smaller file.',
      })
      return
    }

    try {
      const { hash, blobUrl } = await ingestUploadedFile(file, file.type || 'image/png')
      insertHtmlAtCursor(
        `<p><img src="${escapeAttribute(blobUrl)}" alt="${escapeAttribute(file.name)}" data-media-hash="${hash}" /></p>`,
      )
    } catch (err) {
      logger.error('media.upload.image.failed', err, {
        component: 'OutlineItem',
        sizeBytes: file.size,
        mime: file.type || null,
      })
      $q.notify({
        type: 'negative',
        message: 'Could not read the selected image file.',
      })
    }
  }
  input.click()
}

function getEditorContentEl() {
  return longNoteEditor.value?.$el?.querySelector?.('.q-editor__content') || null
}

function removeAudioElement(audio) {
  if (!audio) return
  const parent = audio.parentElement
  const wrapper = audio.closest?.('.embedded-audio-row')
  const removeButton = wrapper?.querySelector?.('[data-remove-audio]')
  if (removeButton) {
    removeButton.remove()
  }
  audio.remove()
  if (wrapper) {
    if (!wrapper.textContent?.trim() && wrapper.children.length === 0) {
      wrapper.remove()
    }
  }
  if (
    parent &&
    parent.tagName === 'P' &&
    !parent.textContent?.trim() &&
    parent.children.length === 0
  ) {
    parent.remove()
  }
  const editorEl = getEditorContentEl()
  editorEl?.dispatchEvent(new Event('input', { bubbles: true }))
}

function handleEditorClick(event) {
  const removeButton = event.target?.closest?.('[data-remove-audio]')
  if (!removeButton) return
  event.preventDefault()
  event.stopPropagation()
  const row = removeButton.closest('.embedded-audio-row')
  const audio = row?.querySelector('audio')
  if (!audio) return
  removeAudioElement(audio)
  $q.notify({
    type: 'positive',
    message: 'Audio removed.',
  })
}

const BLOCK_TAG_NAMES = new Set([
  'P',
  'DIV',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'TR',
  'TD',
  'TH',
  'SECTION',
  'ARTICLE',
])

function findBlockAncestor(node, root) {
  let current = node
  if (current && current.nodeType === Node.TEXT_NODE) current = current.parentNode
  while (current && current !== root) {
    if (current.nodeType === Node.ELEMENT_NODE && BLOCK_TAG_NAMES.has(current.tagName)) {
      return current
    }
    current = current.parentNode
  }
  return current === root ? root : null
}

function rangeIsStrictlyEmpty(range) {
  if (range.toString().length > 0) return false
  const fragment = range.cloneContents()
  if (fragment.querySelector && fragment.querySelector('*')) return false
  return true
}

function audioImmediatelyBeforeCursor(range, block) {
  const audios = Array.from(block.querySelectorAll('audio'))
  if (audios.length === 0) return null
  const candidates = audios.filter((audio) => {
    const audioRange = document.createRange()
    audioRange.selectNode(audio)
    return range.compareBoundaryPoints(Range.START_TO_END, audioRange) >= 0
  })
  if (candidates.length === 0) return null

  const lastAudio = candidates[candidates.length - 1]
  const audioRange = document.createRange()
  audioRange.selectNode(lastAudio)
  const between = document.createRange()
  try {
    between.setStart(audioRange.endContainer, audioRange.endOffset)
    between.setEnd(range.startContainer, range.startOffset)
  } catch {
    return null
  }
  return rangeIsStrictlyEmpty(between) ? lastAudio : null
}

function audioImmediatelyAfterCursor(range, block) {
  const audios = Array.from(block.querySelectorAll('audio'))
  if (audios.length === 0) return null
  const candidates = audios.filter((audio) => {
    const audioRange = document.createRange()
    audioRange.selectNode(audio)
    return range.compareBoundaryPoints(Range.END_TO_START, audioRange) <= 0
  })
  if (candidates.length === 0) return null

  const firstAudio = candidates[0]
  const audioRange = document.createRange()
  audioRange.selectNode(firstAudio)
  const between = document.createRange()
  try {
    between.setStart(range.endContainer, range.endOffset)
    between.setEnd(audioRange.startContainer, audioRange.startOffset)
  } catch {
    return null
  }
  return rangeIsStrictlyEmpty(between) ? firstAudio : null
}

function findAdjacentAudioForDelete(direction) {
  const selection = window.getSelection()
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null

  const editor = getEditorContentEl()
  if (!editor || !editor.contains(selection.anchorNode)) return null

  const range = selection.getRangeAt(0)
  const cursorBlock = findBlockAncestor(range.startContainer, editor)
  if (!cursorBlock) return null

  if (direction === 'backward') {
    return audioImmediatelyBeforeCursor(range, cursorBlock)
  }

  return audioImmediatelyAfterCursor(range, cursorBlock)
}

function removeSelectedAudio() {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    $q.notify({
      type: 'warning',
      message: 'Place the cursor on an audio player or select it first.',
    })
    return
  }

  const range = selection.getRangeAt(0)
  let targetNode = range.commonAncestorContainer
  if (targetNode.nodeType === Node.TEXT_NODE) {
    targetNode = targetNode.parentElement
  }

  const selectedAudio =
    targetNode?.closest?.('audio') ||
    targetNode?.querySelector?.('audio') ||
    range.startContainer?.parentElement?.closest?.('audio') ||
    range.endContainer?.parentElement?.closest?.('audio') ||
    findAdjacentAudioForDelete('backward') ||
    findAdjacentAudioForDelete('forward')

  if (!selectedAudio) {
    $q.notify({
      type: 'warning',
      message: 'No audio player selected to remove.',
    })
    return
  }

  removeAudioElement(selectedAudio)

  $q.notify({
    type: 'positive',
    message: 'Audio removed.',
  })
}

function getRunStyle(scriptType) {
  if (scriptType === 'tibetan') {
    return {
      fontFamily: tibetanFontFamily.value || 'Microsoft Himalaya',
      fontSize: `${Math.round((tibetanFontSize.value || 20) * scaleMultiplier.value)}px`,
      color: tibetanFontColor.value || '#000000',
    }
  }

  return {
    fontFamily: nonTibetanFontFamily.value || 'Aptos, sans-serif',
    fontSize: `${Math.round((nonTibetanFontSize.value || 16) * scaleMultiplier.value)}px`,
    color: nonTibetanFontColor.value || '#000000',
  }
}

function stripHtml(text) {
  if (typeof text !== 'string' || !text) return ''
  const doc = new DOMParser().parseFromString(text, 'text/html')
  return doc.body?.textContent || ''
}

function handleEditorKeydown(event) {
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault()
    if (longNoteEditor.value) {
      longNoteEditor.value.runCmd('indent')
    }
    return
  }

  if (event.key === 'Tab' && event.shiftKey) {
    event.preventDefault()
    if (longNoteEditor.value) {
      longNoteEditor.value.runCmd('outdent')
    }
    return
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    const direction = event.key === 'Backspace' ? 'backward' : 'forward'
    const audio = findAdjacentAudioForDelete(direction)
    if (audio) {
      event.preventDefault()
      removeAudioElement(audio)
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
      .replace(/\r\n|\r|\n/g, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    document.execCommand('insertText', false, cleanedText)
  } else {
    // No selection: parse the editor HTML safely and rewrite as one paragraph.
    const textContent = stripHtml(currentHtml)
    const cleanedText = textContent
      .replace(/\r\n|\r|\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    noteText.value = `<p>${cleanedText}</p>`
  }
}

function increaseNoteEditorFontScale() {
  noteEditorFontScale.value = Math.min(200, noteEditorFontScale.value + 10)
}

function decreaseNoteEditorFontScale() {
  noteEditorFontScale.value = Math.max(50, noteEditorFontScale.value - 10)
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

.root-divider-block {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
}

.root-divider-line {
  flex: 1;
  border-top: 2px solid #b0bec5;
  margin: 0 4px;
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

.placeholder-text {
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

.long-note-content :deep(img),
.long-note-dialog-wrap :deep(.q-editor__content img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 8px 0;
  border-radius: 4px;
}

.long-note-dialog-wrap :deep(.q-editor__content audio) {
  display: block;
  width: min(100%, 480px);
  margin: 8px 0;
  outline: none;
}

.long-note-dialog-wrap :deep(.q-editor__content .embedded-audio-row) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
}

.long-note-dialog-wrap :deep(.q-editor__content .remove-embedded-audio-btn) {
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #ef4444;
  border-radius: 999px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.long-note-dialog-wrap :deep(.q-editor__content .remove-embedded-audio-btn:hover) {
  background: #fef2f2;
  border-color: #fca5a5;
}

.long-note-dialog-wrap {
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
}

.long-note-dialog-wrap :deep(.q-editor__content) {
  padding: 12px;
}

.long-note-dialog-title {
  max-width: 60%;
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
