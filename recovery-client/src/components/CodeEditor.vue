<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

const editorHost = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

function mountEditor() {
  if (!editorHost.value) return;

  const startState = EditorState.create({
    doc: props.modelValue,
    extensions: [
      history(),
      javascript(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      oneDark,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString());
        }
      }),
      EditorView.theme({
        '&': { height: '100%', background: '#1e1e1e', color: '#D4D4D4' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-content': { fontFamily: 'ui-monospace, "Fira Code", Menlo, monospace', fontSize: '0.9rem', lineHeight: '1.5' },
        '.cm-gutters': { background: '#1e1e1e', color: '#858585', borderRight: '1px solid #333333' },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#aeafad' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: '#264f78' },
      }),
    ],
  });

  view = new EditorView({ state: startState, parent: editorHost.value });
}

watch(() => props.modelValue, (value) => {
  if (!view || value === view.state.doc.toString()) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
});

onMounted(() => mountEditor());

onBeforeUnmount(() => {
  view?.destroy();
});
</script>

<template>
  <div class="editor-panel">
    <div class="editor-tab"><span class="editor-tab-dot" aria-hidden="true" /> <span>script.js</span></div>
    <div ref="editorHost" class="editor-host" aria-label="Code editor" />
    <div class="editor-statusbar"><span>JavaScript</span><span>UTF-8</span></div>
  </div>
</template>

<style scoped>
.editor-panel {
  width: 100%;
  min-height: 240px;
  overflow: hidden;
  border-radius: 6px;
}

.editor-tab {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 32px;
  padding: 0 12px;
  background: #252526;
  border-bottom: 2px solid #0e70c0;
  color: #cccccc;
  font: 12px/1 ui-monospace, "Fira Code", Menlo, monospace;
}

.editor-tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #cccccc;
}

.editor-host {
  width: 100%;
  min-height: 240px;
  overflow: auto;
}

.editor-statusbar {
  display: flex;
  justify-content: space-between;
  padding: 2px 12px;
  background: #007acc;
  color: #ffffff;
  font: 12px/1.4 ui-monospace, "Fira Code", Menlo, monospace;
}

.editor-statusbar span:first-child {
  margin-right: auto;
}
</style>
