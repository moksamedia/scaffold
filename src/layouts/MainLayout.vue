<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated>
      <q-toolbar>
        <q-toolbar-title>Outline Maker</q-toolbar-title>
      </q-toolbar>
    </q-header>

    <ProjectsSidebar />

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup>
import ProjectsSidebar from 'components/ProjectsSidebar.vue'
</script>
