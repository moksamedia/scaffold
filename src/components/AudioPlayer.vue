<template>
  <div
    class="custom-audio-player"
    :class="{ playing: isPlaying, loading: isLoading, error: hasError }"
  >
    <audio
      ref="audioEl"
      :src="src"
      preload="metadata"
      @loadedmetadata="onLoadedMetadata"
      @timeupdate="onTimeUpdate"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
      @error="onError"
      @waiting="isLoading = true"
      @canplay="isLoading = false"
    />

    <button
      class="cap-btn cap-btn--main"
      type="button"
      :disabled="hasError"
      :aria-label="isPlaying ? 'Pause' : 'Play'"
      @click="togglePlay"
    >
      <q-icon
        :name="hasError ? 'error_outline' : isPlaying ? 'pause' : 'play_arrow'"
        size="22px"
      />
    </button>

    <div class="cap-time" aria-label="Current time">{{ formatTime(currentTime) }}</div>

    <div
      ref="progressBar"
      class="cap-progress"
      role="slider"
      tabindex="0"
      :aria-valuemin="0"
      :aria-valuemax="duration || 0"
      :aria-valuenow="currentTime"
      @click="onSeek"
      @keydown="onProgressKeydown"
    >
      <div class="cap-progress-track" />
      <div class="cap-progress-fill" :style="{ width: progressPercent + '%' }" />
      <div class="cap-progress-thumb" :style="{ left: progressPercent + '%' }" />
    </div>

    <div class="cap-time" aria-label="Total time">{{ formatTime(duration) }}</div>

    <button
      class="cap-btn cap-btn--icon"
      type="button"
      :aria-label="isMuted ? 'Unmute' : 'Mute'"
      @click="toggleMute"
    >
      <q-icon :name="isMuted ? 'volume_off' : 'volume_up'" size="18px" />
    </button>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

defineProps({
  src: {
    type: String,
    required: true,
  },
})

const audioEl = ref(null)
const progressBar = ref(null)
const isPlaying = ref(false)
const isMuted = ref(false)
const isLoading = ref(false)
const hasError = ref(false)
const currentTime = ref(0)
const duration = ref(0)

const progressPercent = computed(() => {
  if (!duration.value) return 0
  return Math.min(100, Math.max(0, (currentTime.value / duration.value) * 100))
})

function togglePlay() {
  const el = audioEl.value
  if (!el) return
  if (el.paused) {
    el.play().catch(() => {
      hasError.value = true
    })
  } else {
    el.pause()
  }
}

function onPlay() {
  isPlaying.value = true
}

function onPause() {
  isPlaying.value = false
}

function onEnded() {
  isPlaying.value = false
  currentTime.value = 0
}

function onLoadedMetadata() {
  duration.value = audioEl.value?.duration || 0
}

function onTimeUpdate() {
  currentTime.value = audioEl.value?.currentTime || 0
}

function onError() {
  hasError.value = true
  isPlaying.value = false
}

function toggleMute() {
  if (!audioEl.value) return
  audioEl.value.muted = !audioEl.value.muted
  isMuted.value = audioEl.value.muted
}

function seekTo(seconds) {
  if (!audioEl.value || !duration.value) return
  const clamped = Math.max(0, Math.min(duration.value, seconds))
  audioEl.value.currentTime = clamped
  currentTime.value = clamped
}

function onSeek(event) {
  if (!progressBar.value) return
  const rect = progressBar.value.getBoundingClientRect()
  const ratio = (event.clientX - rect.left) / rect.width
  seekTo(ratio * duration.value)
}

function onProgressKeydown(event) {
  if (!duration.value) return
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    seekTo(currentTime.value + 5)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    seekTo(currentTime.value - 5)
  } else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    togglePlay()
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')
  return `${m}:${s}`
}
</script>

<style scoped>
.custom-audio-player {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  margin: 10px 0;
  border-radius: 999px;
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
  border: 1px solid #c7d2fe;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.06),
    0 6px 16px rgba(99, 102, 241, 0.12);
  font-size: 13px;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    system-ui,
    sans-serif;
  user-select: none;
  width: min(100%, 520px);
  box-sizing: border-box;
  transition:
    box-shadow 0.2s ease,
    transform 0.15s ease;
}

.custom-audio-player:hover {
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.08),
    0 8px 22px rgba(99, 102, 241, 0.18);
}

.custom-audio-player.playing {
  background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%);
}

.custom-audio-player.error {
  background: linear-gradient(135deg, #fef2f2 0%, #fecaca 100%);
  border-color: #fca5a5;
}

.custom-audio-player audio {
  display: none;
}

.cap-btn {
  background: white;
  border: 1px solid #c7d2fe;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #4338ca;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.1s ease,
    box-shadow 0.2s ease;
  padding: 0;
  flex-shrink: 0;
}

.cap-btn--main {
  width: 36px;
  height: 36px;
  box-shadow: 0 1px 3px rgba(67, 56, 202, 0.2);
}

.cap-btn--icon {
  width: 28px;
  height: 28px;
}

.cap-btn:hover:not(:disabled) {
  background: #4338ca;
  color: white;
  transform: scale(1.05);
}

.cap-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.cap-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.custom-audio-player.playing .cap-btn--main {
  background: #4338ca;
  color: white;
}

.cap-time {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: #1e1b4b;
  min-width: 38px;
  text-align: center;
  flex-shrink: 0;
}

.cap-progress {
  position: relative;
  flex: 1;
  height: 22px;
  display: flex;
  align-items: center;
  cursor: pointer;
  outline: none;
}

.cap-progress:focus-visible .cap-progress-track {
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.4);
}

.cap-progress-track {
  position: absolute;
  left: 0;
  right: 0;
  height: 6px;
  background: rgba(67, 56, 202, 0.15);
  border-radius: 999px;
  transition: box-shadow 0.2s ease;
}

.cap-progress-fill {
  position: absolute;
  left: 0;
  height: 6px;
  background: linear-gradient(90deg, #6366f1, #4338ca);
  border-radius: 999px;
  transition: width 0.1s linear;
  pointer-events: none;
}

.cap-progress-thumb {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
  border: 2px solid #4338ca;
  transform: translateX(-50%);
  box-shadow: 0 1px 3px rgba(67, 56, 202, 0.3);
  pointer-events: none;
  transition: transform 0.15s ease;
}

.cap-progress:hover .cap-progress-thumb {
  transform: translateX(-50%) scale(1.15);
}
</style>
