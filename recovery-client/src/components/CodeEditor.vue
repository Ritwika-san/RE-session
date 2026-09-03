<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';

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
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString());
        }
      }),
      EditorView.theme({
        '&': { height: '100%', border: '1px solid #D8DBD8', borderRadius: '0.75rem', background: '#FFFFFF' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.9rem', lineHeight: '1.5' },
        '.cm-gutters': { background: '#EEF0EE', borderRight: '1px solid #D8DBD8' },
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
  <div ref="editorHost" class="editor-host" aria-label="Code editor" />
</template>

<style scoped>
.editor-host {
  width: 100%;
  min-height: 240px;
  overflow: auto;
}
</style>
