/**
 * 📂 FileManager Component (Mónaco Editor & File Tree)
 * Encapsula la lógica de gestión de archivos y editor de código avanzado.
 */
export class FileManager {
    constructor(containerId, editorContainerId) {
        this.container = document.getElementById(containerId);
        this.editorContainer = document.getElementById(editorContainerId);
        this.editor = null;
        this.currentFilePath = null;
    }

    initMonaco() {
        if (window.monaco && this.editorContainer && !this.editor) {
            this.editor = monaco.editor.create(this.editorContainer, {
                value: '// Selecciona un archivo para editar',
                language: 'javascript',
                theme: 'vs-dark',
                automaticLayout: true,
                fontSize: 14
            });
        }
    }

    openFile(filePath, content, language = 'javascript') {
        this.currentFilePath = filePath;
        if (!this.editor) {
            this.initMonaco();
        }
        if (this.editor) {
            const model = monaco.editor.createModel(content, language);
            this.editor.setModel(model);
        }
    }

    getContent() {
        return this.editor ? this.editor.getValue() : '';
    }
}
