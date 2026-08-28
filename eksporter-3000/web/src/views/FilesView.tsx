import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download, FileText, Loader2, Paperclip, StickyNote, Trash2, Upload, XCircle,
} from 'lucide-react';
import { Card, CopyButton, Empty, PageHeader } from '../ui';
import {
  deleteFile, fileDownloadUrl, getFiles, setFileNote, uploadFiles, type ImportFile,
} from '../api';
import { plural } from '../helpers';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FilesView: React.FC<{ oid: string; onChanged?: () => void }> = ({ oid, onChanged }) => {
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    getFiles(oid)
      .then(setFiles)
      .catch(err => setError(err.message ?? String(err)))
      .finally(() => setLoading(false));
  }, [oid]);

  useEffect(reload, [reload]);

  const send = async (selected: FileList | File[]) => {
    const list = Array.from(selected);
    if (list.length === 0) return;

    setUploading(true);
    setError(null);
    try {
      await uploadFiles(oid, list);
      reload();
      onChanged?.();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (file: ImportFile) => {
    if (!confirm(`Skasować „${file.filename}"? Pliku nie da się odzyskać.`)) return;
    await deleteFile(file.id);
    reload();
    onChanged?.();
  };

  const saveNote = async (file: ImportFile) => {
    await setFileNote(file.id, noteDraft);
    setNoteFor(null);
    reload();
  };

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div>
      <PageHeader
        title="Pliki importu"
        count={files.length}
        subtitle="Miejsce na materiały do tego obiektu: arkusze, zdjęcia od właściciela, notatki, gotowe paczki do wgrania w nowym PMS. Pliki leżą na serwerze obok bazy - nie idą nigdzie dalej i nie mają nic wspólnego z Hotresem."
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          Wgraj pliki
        </button>
      </PageHeader>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={event => {
          if (event.target.files) void send(event.target.files);
          event.target.value = '';
        }}
      />

      <div
        onDragOver={event => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer.files) void send(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 mb-5 text-center cursor-pointer transition-colors ${
          dragging
            ? 'border-indigo-500 bg-indigo-500/5'
            : 'border-slate-700 hover:border-slate-600 bg-surface'
        }`}
      >
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-slate-300">
            <Loader2 size={18} className="animate-spin" /> Wgrywam…
          </div>
        ) : (
          <>
            <Paperclip size={22} className="mx-auto mb-2 text-slate-500" />
            <p className="text-sm text-slate-300">
              Przeciągnij pliki tutaj albo kliknij, żeby wybrać
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Dowolny format, do 200 MB na plik. Można wrzucić kilka naraz.
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm mb-5">
          <XCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Loader2 size={16} className="animate-spin" /> Wczytuję listę…
        </div>
      ) : files.length === 0 ? (
        <Empty text="Nie ma tu jeszcze żadnych plików" />
      ) : (
        <Card
          title={`${plural(files.length, ['plik', 'pliki', 'plików'])} · ${humanSize(totalSize)}`}
        >
          <div className="space-y-1.5">
            {files.map(file => (
              <div key={file.id} className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <FileText size={16} className="text-slate-500 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white break-all">{file.filename}</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap mt-0.5">
                      <span>{humanSize(file.size)}</span>
                      {file.mimeType && <span className="font-mono">{file.mimeType}</span>}
                      <span>{new Date(file.uploadedAt).toLocaleString('pl-PL')}</span>
                      {file.uploadedBy && <span>· {file.uploadedBy}</span>}
                    </div>
                  </div>

                  <CopyButton value={file.filename} label="Nazwa" />

                  <a
                    href={fileDownloadUrl(file.id)}
                    className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
                    title="Pobierz"
                  >
                    <Download size={14} />
                  </a>

                  <button
                    type="button"
                    onClick={() => {
                      setNoteFor(noteFor === file.id ? null : file.id);
                      setNoteDraft(file.note ?? '');
                    }}
                    title="Notatka"
                    className={`p-1.5 rounded-lg border transition-colors ${
                      file.note
                        ? 'border-amber-500/40 text-amber-300'
                        : 'border-slate-700 text-slate-500 hover:text-white'
                    }`}
                  >
                    <StickyNote size={14} />
                  </button>

                  <button
                    type="button"
                    onClick={() => remove(file)}
                    title="Skasuj"
                    className="p-1.5 rounded-lg border border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-500/40 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {file.note && noteFor !== file.id && (
                  <div className="text-xs text-amber-300/80 mt-2 flex items-start gap-1.5">
                    <StickyNote size={11} className="mt-0.5 flex-shrink-0" />
                    <span className="break-words">{file.note}</span>
                  </div>
                )}

                {noteFor === file.id && (
                  <div className="flex gap-2 mt-2">
                    <input
                      autoFocus
                      value={noteDraft}
                      onChange={event => setNoteDraft(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') saveNote(file);
                        if (event.key === 'Escape') setNoteFor(null);
                      }}
                      placeholder="po co ten plik, np. cennik od właściciela na 2027"
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => saveNote(file)}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-lg text-sm"
                    >
                      Zapisz
                    </button>
                    <button
                      type="button"
                      onClick={() => setNoteFor(null)}
                      className="border border-slate-700 text-slate-400 px-3 py-2 rounded-lg text-sm"
                    >
                      Anuluj
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
