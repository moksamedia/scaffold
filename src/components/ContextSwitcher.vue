<template>
  <div class="context-switcher">
    <q-btn
      flat
      dense
      no-caps
      class="context-switcher__trigger"
      :loading="switchingContext"
      :disable="switchingContext"
      aria-label="Switch context"
    >
      <q-icon name="account_circle" class="q-mr-xs" />
      <span class="context-switcher__label">{{ activeContextName }}</span>
      <q-icon name="expand_more" />
      <q-tooltip>Switch context</q-tooltip>

      <q-menu auto-close>
        <q-list dense style="min-width: 220px">
          <q-item-label header>Active context</q-item-label>
          <q-item
            v-for="ctx in contexts"
            :key="ctx.id"
            clickable
            :active="ctx.id === activeContextId"
            active-class="bg-primary text-white"
            @click="onSelectContext(ctx.id)"
          >
            <q-item-section>
              <q-item-label>{{ ctx.name }}</q-item-label>
              <q-item-label caption>
                {{ ctx.id === activeContextId ? 'Current' : 'Switch to this context' }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-icon
                v-if="ctx.id === activeContextId"
                name="check_circle"
                color="positive"
                size="sm"
              />
            </q-item-section>
          </q-item>

          <q-separator class="q-my-xs" />

          <q-item clickable @click="openCreateDialog">
            <q-item-section avatar>
              <q-icon name="add" />
            </q-item-section>
            <q-item-section>New context…</q-item-section>
          </q-item>

          <q-item clickable @click="openManageDialog">
            <q-item-section avatar>
              <q-icon name="settings" />
            </q-item-section>
            <q-item-section>Manage contexts…</q-item-section>
          </q-item>
        </q-list>
      </q-menu>
    </q-btn>

    <!-- Create context dialog -->
    <q-dialog v-model="showCreateDialog">
      <q-card style="min-width: 420px">
        <q-card-section>
          <div class="text-h6">New Context</div>
          <div class="text-caption text-grey-8 q-mt-xs">
            A context is a separate workspace with its own projects,
            version history, settings, and media backend. Use it to
            keep different sets of work isolated.
          </div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="newContextName"
            label="Context name"
            autofocus
            @keyup.enter="confirmCreateContext"
          />
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="text-subtitle2 q-mb-xs">Initial contents</div>
          <q-option-group
            v-model="newContextSeed"
            type="radio"
            :options="seedOptions"
            class="context-switcher__seed-options"
          />
          <div class="text-caption text-grey-8 q-mt-sm">
            <template v-if="newContextSeed === 'fresh'">
              Starts blank — you'll get the welcome example project
              and default program-wide settings.
            </template>
            <template v-else>
              Copies projects, version history, program settings,
              and media-backend configuration from
              <strong>{{ activeContextName }}</strong>. Media bytes
              are shared, so this is cheap regardless of size. Future
              edits stay isolated to the new context.
            </template>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup :disable="isCreating" />
          <q-btn
            flat
            color="primary"
            :label="confirmButtonLabel"
            :loading="isCreating"
            :disable="!newContextName.trim()"
            @click="confirmCreateContext"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Manage contexts dialog -->
    <q-dialog v-model="showManageDialog">
      <q-card style="min-width: 480px">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Manage Contexts</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <div class="text-caption text-grey-8 q-mb-md">
            Each context has its own projects, version history,
            program-wide settings, and media-backend connections.
            Deleting a context permanently removes its projects and
            versions.
          </div>

          <q-list separator>
            <q-item v-for="ctx in contexts" :key="ctx.id">
              <q-item-section v-if="renamingId !== ctx.id">
                <q-item-label>
                  {{ ctx.name }}
                  <q-badge
                    v-if="ctx.id === activeContextId"
                    color="primary"
                    class="q-ml-sm"
                  >
                    Active
                  </q-badge>
                </q-item-label>
                <q-item-label caption>
                  Created {{ formatDate(ctx.createdAt) }}
                </q-item-label>
              </q-item-section>

              <q-item-section v-else>
                <q-input
                  v-model="renamingValue"
                  dense
                  autofocus
                  @keyup.enter="confirmRename(ctx.id)"
                  @keyup.esc="cancelRename"
                  @blur="confirmRename(ctx.id)"
                />
              </q-item-section>

              <q-item-section side v-if="renamingId !== ctx.id">
                <div class="row q-gutter-xs">
                  <q-btn
                    v-if="ctx.id !== activeContextId"
                    flat
                    dense
                    round
                    icon="login"
                    color="primary"
                    @click="onSelectContext(ctx.id)"
                  >
                    <q-tooltip>Switch to this context</q-tooltip>
                  </q-btn>
                  <q-btn
                    flat
                    dense
                    round
                    icon="edit"
                    @click="startRename(ctx)"
                  >
                    <q-tooltip>Rename</q-tooltip>
                  </q-btn>
                  <q-btn
                    flat
                    dense
                    round
                    icon="delete"
                    color="negative"
                    :disable="contexts.length <= 1"
                    @click="confirmDelete(ctx)"
                  >
                    <q-tooltip v-if="contexts.length <= 1">
                      Cannot delete the only context
                    </q-tooltip>
                    <q-tooltip v-else>Delete</q-tooltip>
                  </q-btn>
                </div>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="New context…" icon="add" @click="openCreateDialog" />
          <q-btn flat label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useOutlineStore } from 'stores/outline-store'
import { storeToRefs } from 'pinia'
import { useQuasar } from 'quasar'
import { logger } from 'src/utils/logging/logger.js'

const store = useOutlineStore()
const $q = useQuasar()
const { contexts, activeContextId, switchingContext } = storeToRefs(store)

const showCreateDialog = ref(false)
const showManageDialog = ref(false)
const newContextName = ref('')
const newContextSeed = ref('fresh')
const isCreating = ref(false)
const renamingId = ref(null)
const renamingValue = ref('')

const activeContextName = computed(() => {
  const active = contexts.value.find((c) => c.id === activeContextId.value)
  return active?.name || 'Default'
})

const seedOptions = computed(() => [
  {
    label: 'Start fresh with default settings',
    value: 'fresh',
  },
  {
    label: `Clone current context (${activeContextName.value})`,
    value: 'clone',
  },
])

const confirmButtonLabel = computed(() =>
  newContextSeed.value === 'clone'
    ? 'Clone and switch'
    : 'Create and switch',
)

watch(showManageDialog, async (visible) => {
  if (visible) {
    await store.refreshContextRegistry()
  }
})

async function onSelectContext(id) {
  if (id === activeContextId.value) return
  logger.debug('context.switch.userIntent', {
    component: 'ContextSwitcher',
    fromContextId: activeContextId.value,
    toContextId: id,
  })
  try {
    const ok = await store.switchContext(id)
    if (ok) {
      $q.notify({
        type: 'positive',
        message: `Switched to "${activeContextName.value}"`,
        position: 'top',
        timeout: 2000,
      })
    }
  } catch (error) {
    logger.error('context.switch.userFlow.failed', error, {
      component: 'ContextSwitcher',
      toContextId: id,
    })
    $q.notify({
      type: 'negative',
      message: `Could not switch context: ${error.message}`,
      position: 'top',
      timeout: 4000,
    })
  }
}

function openCreateDialog() {
  newContextName.value = ''
  newContextSeed.value = 'fresh'
  showCreateDialog.value = true
}

function openManageDialog() {
  showManageDialog.value = true
}

async function confirmCreateContext() {
  const name = newContextName.value.trim()
  if (!name) return
  const cloneFromCurrent = newContextSeed.value === 'clone'
  isCreating.value = true
  try {
    await store.createNewContext(name, {
      activate: true,
      cloneFromCurrent,
    })
    showCreateDialog.value = false
    newContextName.value = ''
    newContextSeed.value = 'fresh'
    $q.notify({
      type: 'positive',
      message: cloneFromCurrent
        ? `Cloned context as "${name}"`
        : `Created and switched to "${name}"`,
      position: 'top',
      timeout: 2000,
    })
  } catch (error) {
    logger.error('context.create.userFlow.failed', error, {
      component: 'ContextSwitcher',
      cloneFromCurrent,
    })
    $q.notify({
      type: 'negative',
      message: `Could not create context: ${error.message}`,
      position: 'top',
      timeout: 4000,
    })
  } finally {
    isCreating.value = false
  }
}

function startRename(ctx) {
  renamingId.value = ctx.id
  renamingValue.value = ctx.name
}

function cancelRename() {
  renamingId.value = null
  renamingValue.value = ''
}

async function confirmRename(id) {
  const newName = renamingValue.value.trim()
  if (!newName) {
    cancelRename()
    return
  }
  try {
    await store.renameContextById(id, newName)
  } catch (error) {
    logger.error('context.rename.userFlow.failed', error, {
      component: 'ContextSwitcher',
      contextId: id,
    })
    $q.notify({
      type: 'negative',
      message: `Rename failed: ${error.message}`,
      position: 'top',
      timeout: 3000,
    })
  } finally {
    cancelRename()
  }
}

function confirmDelete(ctx) {
  $q.dialog({
    title: 'Delete Context',
    message:
      `Permanently delete "${ctx.name}"? Its projects, version ` +
      'history, and program-wide settings will be removed. ' +
      'Media files referenced only by this context will be ' +
      'cleaned up by automated garbage collection. ' +
      'This action cannot be undone.',
    cancel: true,
    persistent: true,
    ok: { label: 'Delete', color: 'negative' },
  }).onOk(async () => {
    try {
      const result = await store.deleteContextById(ctx.id)
      if (!result.deleted) {
        $q.notify({
          type: 'warning',
          message:
            result.reason === 'last-context'
              ? 'Cannot delete the only remaining context.'
              : 'Context could not be deleted.',
          position: 'top',
          timeout: 3000,
        })
        return
      }
      $q.notify({
        type: 'positive',
        message: `Deleted "${ctx.name}"`,
        position: 'top',
        timeout: 2000,
      })
    } catch (error) {
      logger.error('context.delete.userFlow.failed', error, {
        component: 'ContextSwitcher',
        contextId: ctx.id,
      })
      $q.notify({
        type: 'negative',
        message: `Delete failed: ${error.message}`,
        position: 'top',
        timeout: 4000,
      })
    }
  })
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}
</script>

<style scoped>
.context-switcher__trigger {
  text-transform: none;
}

.context-switcher__label {
  margin-right: 4px;
  font-weight: 500;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-switcher__seed-options :deep(.q-radio__label) {
  font-size: 14px;
}
</style>
