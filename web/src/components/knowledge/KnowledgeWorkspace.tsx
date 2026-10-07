import React, { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  Search,
  Upload,
  FileText,
  FileSpreadsheet,
  FileCode,
  AlertCircle,
  X,
} from 'lucide-react';
import { KnowledgeItem, KnowledgeStatus } from '../../types/agent';
import { TechLoadingAnimation } from '../ui/TechLoadingAnimation';

export const KnowledgeWorkspace: React.FC = () => {
  const { knowledge, uploadFiles, t, isRTL } = useWorkspace();
  const [search, setSearch] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const filteredKnowledge = knowledge.filter((item) => {
    const name = (isRTL ? item.nameFa || item.name : item.name).toLowerCase();
    const query = search.toLowerCase();
    return name.includes(query) || item.type.toLowerCase().includes(query);
  });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(Array.from(e.target.files));
    }
  };

  const processFiles = (files: File[]) => {
    // The backend owns indexing: it returns rows as `Uploading` and advances them durably.
    uploadFiles(files);
  };

  // M3 Assist Chip for Knowledge Status
  const getStatusBadge = (status: KnowledgeStatus, progress?: number) => {
    switch (status) {
      case 'Ready':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {t.ready}
          </span>
        );
      case 'Processing':
      case 'Indexing':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]">
            <TechLoadingAnimation variant="circular" size="sm" />
            {t.processing}
          </span>
        );
      case 'Uploading':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]">
            <TechLoadingAnimation variant="circular" size="sm" />
            {t.uploading}
          </span>
        );
      case 'Failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] border border-[var(--md-sys-color-error)]/20">
            <AlertCircle className="w-3 h-3 text-[var(--md-sys-color-error)]" />
            {t.failed}
          </span>
        );
    }
  };

  // M3 Monochromatic File Icon (Calm, no distracting rainbow colors)
  const getFileIcon = (type: string) => {
    const iconClass = "w-5 h-5 text-[var(--md-sys-color-on-surface-variant)] stroke-[1.8]";
    let IconComp = FileText;
    if (type === 'csv' || type === 'xlsx') {
      IconComp = FileSpreadsheet;
    } else if (type === 'json' || type === 'code') {
      IconComp = FileCode;
    }

    return (
      <div className="w-9 h-9 rounded-lg bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center shrink-0">
        <IconComp className={iconClass} />
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 max-w-5xl mx-auto w-full space-y-6 bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[var(--md-sys-color-outline-variant)]">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-[var(--md-sys-color-on-surface)]">
          {t.knowledgeTitle}
        </h1>

        {/* Upload — neutral weight, it is a routine action */}
        <label className="cursor-pointer flex items-center gap-2 h-9 px-3.5 rounded-lg bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] font-medium text-xs hover:bg-[var(--md-sys-color-surface-container-highest)] transition-colors self-start sm:self-auto">
          <Upload className="w-4 h-4" />
          <span>{t.uploadFiles}</span>
          <input type="file" multiple className="hidden" onChange={handleFileInput} />
        </label>
      </div>

      {/* Drag & Drop Upload Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`p-6 rounded-lg border border-dashed transition-colors text-center flex flex-col items-center justify-center gap-2 ${
          isDragging
            ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]/15'
            : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container)] hover:border-[var(--md-sys-color-outline)]'
        }`}
      >
        <div className="w-9 h-9 rounded-lg bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center text-[var(--md-sys-color-on-surface-variant)]">
          <Upload className="w-5 h-5 stroke-[1.8]" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
            {t.dragDropFiles}
          </p>
          <p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
            {t.fileFormatsHint}
          </p>
        </div>
      </div>

      {/* Full-Width Search Input following Google Material 3 Search Bar spec */}
      <div className="w-full relative">
        <div className="w-full h-10 rounded-lg bg-[var(--md-sys-color-surface-container)] flex items-center px-3.5 gap-2.5 transition-colors">
          <Search className="w-4 h-4 text-[var(--md-sys-color-on-surface-variant)] shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchKnowledge}
            className="w-full bg-transparent text-xs text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="p-1 rounded-full text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Knowledge Collections Cards: Uniform grid, aligned, calm M3 styling */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
        {filteredKnowledge.map((item) => (
          <div
            key={item.id}
            className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container)] hover:bg-[var(--md-sys-color-surface-container-low)] transition-colors flex flex-col justify-between gap-3 min-h-[148px] group"
          >
            {/* Top info */}
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {getFileIcon(item.type)}
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-[var(--md-sys-color-on-surface)] truncate">
                      {isRTL ? item.nameFa || item.name : item.name}
                    </h3>
                    <div className="mt-1">{getStatusBadge(item.status, item.progressPercent)}</div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs font-mono tabular-nums text-[var(--md-sys-color-on-surface-variant)] pt-2 border-t border-[var(--md-sys-color-outline-variant)]">
                <span>
                  {item.fileCount} {t.files} · {item.sizeFormatted}
                </span>
                <span>
                  {item.chunksCount} {t.chunksIndexed}
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-2 mt-2 flex items-center justify-between text-[11px] text-[var(--md-sys-color-on-surface-variant)] font-mono">
              <span>
                {t.updated}: {item.updatedAt}
              </span>
              <span className="uppercase text-[10px] px-2 py-0.5 rounded bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]">
                {item.type}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
