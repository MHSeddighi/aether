import React, { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  Search,
  Globe,
  Database,
  Terminal,
  Server,
  Cpu,
  Link,
  X,
  BarChart3,
  Filter,
} from 'lucide-react';
import { ToolItem, ConnectionState } from '../../types/agent';
import { M3Switch } from '../ui/M3Switch';

interface ToolTelemetryDetail {
  toolId: string;
  totalCalls24h: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  successRatePercent: number;
  lastInvoked: string;
  errorCount: number;
  sampleInput: string;
  sampleOutput: string;
}

const MOCK_TOOL_STATS: Record<string, ToolTelemetryDetail> = {
  'tool-web-search': {
    toolId: 'tool-web-search',
    totalCalls24h: 12450,
    avgLatencyMs: 145,
    p99LatencyMs: 380,
    successRatePercent: 99.92,
    lastInvoked: '1m ago',
    errorCount: 1,
    sampleInput: '{"query": "Gemini 2.5 Flash architectural benchmark 2026"}',
    sampleOutput: '{"status": 200, "resultsCount": 8, "latencyMs": 142}',
  },
  'tool-hybrid-vector': {
    toolId: 'tool-hybrid-vector',
    totalCalls24h: 8940,
    avgLatencyMs: 42,
    p99LatencyMs: 110,
    successRatePercent: 100.0,
    lastInvoked: '4m ago',
    errorCount: 0,
    sampleInput: '{"queryEmbedding": [0.024, -0.19, 0.44], "topK": 5}',
    sampleOutput: '{"matches": 5, "cosineSimilarity": 0.94, "chunks": 5}',
  },
  'tool-python-sandbox': {
    toolId: 'tool-python-sandbox',
    totalCalls24h: 3120,
    avgLatencyMs: 280,
    p99LatencyMs: 650,
    successRatePercent: 99.4,
    lastInvoked: '12m ago',
    errorCount: 2,
    sampleInput: '{"code": "import numpy as np; print(np.mean([10, 20, 30]))"}',
    sampleOutput: '{"stdout": "20.0\\n", "exitCode": 0, "execMs": 274}',
  },
  'tool-sql-db': {
    toolId: 'tool-sql-db',
    totalCalls24h: 4620,
    avgLatencyMs: 68,
    p99LatencyMs: 190,
    successRatePercent: 99.8,
    lastInvoked: '7m ago',
    errorCount: 1,
    sampleInput: '{"sql": "SELECT id, revenue FROM quarterly_sales LIMIT 5"}',
    sampleOutput: '{"rowCount": 5, "executionMs": 61}',
  },
  'tool-mcp-server': {
    toolId: 'tool-mcp-server',
    totalCalls24h: 1890,
    avgLatencyMs: 25,
    p99LatencyMs: 70,
    successRatePercent: 100.0,
    lastInvoked: '18m ago',
    errorCount: 0,
    sampleInput: '{"method": "tools/call", "params": {"name": "read_resource"}}',
    sampleOutput: '{"status": "ok", "protocolVersion": "2026.1"}',
  },
  'tool-http-api': {
    toolId: 'tool-http-api',
    totalCalls24h: 640,
    avgLatencyMs: 195,
    p99LatencyMs: 520,
    successRatePercent: 98.2,
    lastInvoked: '45m ago',
    errorCount: 4,
    sampleInput: '{"endpoint": "https://api.internal.corp/webhook/sync"}',
    sampleOutput: '{"status": 200, "delivered": true}',
  },
};

export const ToolsWorkspace: React.FC = () => {
  const { tools, toggleTool, t, isRTL, bots } = useWorkspace();
  const [search, setSearch] = useState('');
  const [selectedTool, setSelectedTool] = useState<ToolItem | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'search' | 'data' | 'compute' | 'mcp' | 'api'>('all');

  // Filter tools strictly for search and category
  const filteredTools = tools.filter((tool) => {
    const name = (isRTL ? tool.nameFa || tool.name : tool.name).toLowerCase();
    const purpose = (isRTL ? tool.purposeFa || tool.purpose : tool.purpose).toLowerCase();
    const query = search.toLowerCase();
    const matchesSearch = name.includes(query) || purpose.includes(query);
    if (!matchesSearch) return false;
    if (categoryFilter !== 'all' && tool.category !== categoryFilter) return false;
    return true;
  });

  const activeCount = tools.filter((t) => t.enabled).length;

  const getToolIcon = (iconName: string) => {
    const iconClass = 'w-4.5 h-4.5 text-[var(--md-sys-color-on-surface)] stroke-[1.8]';
    let IconComp = Link;
    switch (iconName) {
      case 'Globe':
        IconComp = Globe;
        break;
      case 'Database':
        IconComp = Database;
        break;
      case 'Terminal':
        IconComp = Terminal;
        break;
      case 'Server':
        IconComp = Server;
        break;
      case 'Cpu':
        IconComp = Cpu;
        break;
      default:
        IconComp = Link;
    }

    return (
      <div className="w-9 h-9 rounded-lg bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center shrink-0">
        <IconComp className={iconClass} />
      </div>
    );
  };

  const getLocalizedCategory = (cat: string) => {
    switch (cat.toLowerCase()) {
      case 'search':
        return t.categoryWeb;
      case 'data':
        return t.categoryData;
      case 'compute':
        return t.categoryDev;
      case 'api':
        return t.categoryCloud;
      case 'mcp':
        return t.categoryModel;
      default:
        return cat;
    }
  };

  const selectedStats = selectedTool ? MOCK_TOOL_STATS[selectedTool.id] : null;

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 max-w-6xl mx-auto w-full space-y-6 bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)] select-none">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--md-sys-color-outline-variant)]">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-[var(--md-sys-color-on-surface)]">
          {t.toolTelemetry}
        </h1>

        <span className="text-xs text-[var(--md-sys-color-on-surface-variant)] self-start sm:self-auto">
          {activeCount}/{tools.length} {t.operational}
        </span>
      </div>


      {/* Search & Category Filter bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Full-Width Search Input */}
        <div className="flex-1 relative">
          <div className="h-10 rounded-lg bg-[var(--md-sys-color-surface-container)] flex items-center px-3.5 gap-2.5 transition-colors">
            <Search className="w-4 h-4 text-[var(--md-sys-color-on-surface-variant)] shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchTools}
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

        {/* Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {(
            [
              { id: 'all', label: t.all },
              { id: 'search', label: t.categoryWeb },
              { id: 'data', label: t.categoryData },
              { id: 'compute', label: t.categoryDev },
              { id: 'mcp', label: t.categoryModel },
              { id: 'api', label: t.categoryCloud },
            ] as const
          ).map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategoryFilter(cat.id)}
              className={`h-8 px-2.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                categoryFilter === cat.id
                  ? 'bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)] font-semibold'
                  : 'text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container)]'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tool cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredTools.map((tool) => {
          return (
            <div
              key={tool.id}
              className="p-4 rounded-lg bg-[var(--md-sys-color-surface-container)] hover:bg-[var(--md-sys-color-surface-container-low)] transition-colors flex flex-col justify-between space-y-3.5"
            >
              {/* Card Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {getToolIcon(tool.icon)}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-[var(--md-sys-color-on-surface)] truncate">
                        {isRTL ? tool.nameFa || tool.name : tool.name}
                      </h3>
                      <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]">
                        {getLocalizedCategory(tool.category)}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] leading-snug line-clamp-1 mt-0.5">
                      {isRTL ? tool.purposeFa || tool.purpose : tool.purpose}
                    </p>
                  </div>
                </div>

                {/* Status Switch — bare, no surrounding box */}
                <div className="flex items-center shrink-0">
                  <M3Switch
                    checked={tool.enabled}
                    onChange={() => toggleTool(tool.id)}
                    ariaLabel={isRTL ? tool.nameFa || tool.name : tool.name}
                  />
                </div>
              </div>

              {/* Footer: single action */}
              <div className="flex items-center justify-end pt-2.5 border-t border-[var(--md-sys-color-outline-variant)]">
                <button
                  type="button"
                  onClick={() => setSelectedTool(tool)}
                  className="h-7 px-2.5 rounded-lg bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] text-[11px] font-semibold hover:bg-[var(--md-sys-color-surface-container-highest)] transition-colors flex items-center gap-1"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>Telemetry</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Telemetry Inspection Modal (Read-only statistical traces, NOT development mode) */}
      {selectedTool && selectedStats && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          onClick={() => setSelectedTool(null)}
        >
          <div
            className="w-full max-w-lg bg-[var(--md-sys-color-surface-container-low)] rounded-xl p-5 shadow-2xl space-y-4 animate-in fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-[var(--md-sys-color-outline-variant)]">
              <div className="flex items-center gap-3">
                {getToolIcon(selectedTool.icon)}
                <div>
                  <h3 className="text-sm font-semibold text-[var(--md-sys-color-on-surface)]">
                    {isRTL ? selectedTool.nameFa || selectedTool.name : selectedTool.name}
                  </h3>
                  <span className="text-[11px] font-mono text-[var(--md-sys-color-on-surface-variant)]">
                    {getLocalizedCategory(selectedTool.category)} · Infrastructure Metric
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTool(null)}
                className="p-1.5 rounded-full text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-high)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Performance Gauges */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container)]">
                <span className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] block mb-1">
                  24h Requests
                </span>
                <span className="text-base font-semibold font-mono text-[var(--md-sys-color-on-surface)]">
                  {selectedStats.totalCalls24h.toLocaleString()}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container)]">
                <span className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] block mb-1">
                  Median / P99
                </span>
                <span className="text-base font-semibold font-mono text-[var(--md-sys-color-on-surface)]">
                  {selectedStats.avgLatencyMs} / {selectedStats.p99LatencyMs}ms
                </span>
              </div>
              <div className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container)]">
                <span className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] block mb-1">
                  Uptime
                </span>
                <span className="text-base font-semibold font-mono text-emerald-500">
                  {selectedStats.successRatePercent}%
                </span>
              </div>
            </div>

            {/* Recent Payload Traces */}
            <div className="space-y-2 text-xs">
              <span className="font-semibold text-[var(--md-sys-color-on-surface)] block">
                Last Trace Payload
              </span>
              <div className="space-y-1.5">
                <div className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container-lowest)] font-mono text-[11px] text-[var(--md-sys-color-on-surface)] overflow-x-auto">
                  <span className="text-[var(--md-sys-color-on-surface-variant)]">// Request payload</span>
                  <pre className="mt-1">{selectedStats.sampleInput}</pre>
                </div>
                <div className="p-3 rounded-lg bg-[var(--md-sys-color-surface-container-lowest)] font-mono text-[11px] text-emerald-500 overflow-x-auto">
                  <span className="text-[var(--md-sys-color-on-surface-variant)]">// Execution response</span>
                  <pre className="mt-1">{selectedStats.sampleOutput}</pre>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--md-sys-color-outline-variant)]">
              <div className="flex items-center gap-2">
                <M3Switch
                  checked={selectedTool.enabled}
                  onChange={() => toggleTool(selectedTool.id)}
                />
                <span className="text-xs text-[var(--md-sys-color-on-surface-variant)]">
                  {selectedTool.enabled ? t.enabled : t.disabled}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setSelectedTool(null)}
                className="h-8 px-3.5 rounded-lg bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] text-xs font-semibold hover:bg-[var(--md-sys-color-surface-container-highest)] transition-colors"
              >
                {t.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
