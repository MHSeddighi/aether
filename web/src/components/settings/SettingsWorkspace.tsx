import React, { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  Moon,
  Sun,
  Monitor,
  Globe,
  Sliders,
  ShieldAlert,
  Sparkles,
  Layers,
  Palette,
  Check,
  RotateCcw,
  User,
  CreditCard,
  Zap,
  LogOut,
} from 'lucide-react';
import { SupportedLocale } from '../../lib/i18n/translations';

export const SettingsWorkspace: React.FC = () => {
  const {
    themeMode,
    setThemeMode,
    customPrimaryColor,
    setCustomPrimaryColor,
    locale,
    setLocale,
    account,
    session,
    signOut,
    resetWorkspaceData,
    t,
    isRTL,
  } = useWorkspace();

  const [hexInput, setHexInput] = useState(customPrimaryColor.replace('#', ''));

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6);
    setHexInput(val);
    if (val.length === 6) {
      setCustomPrimaryColor(`#${val}`);
    }
  };

  const handleColorPickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setCustomPrimaryColor(newColor);
    setHexInput(newColor.replace('#', ''));
  };

  const handleApplyHex = () => {
    if (hexInput.length === 6 || hexInput.length === 3) {
      setCustomPrimaryColor(`#${hexInput}`);
    }
  };

  const handleResetData = () => {
    if (window.confirm(t.resetConfirm)) {
      resetWorkspaceData();
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 max-w-4xl mx-auto w-full space-y-6 bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)]">
      {/* Header */}
      <div className="pb-2 border-b border-[var(--md-sys-color-outline-variant)]">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-[var(--md-sys-color-on-surface)]">
          {t.settingsTitle}
        </h1>
        <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] mt-0.5">
          {t.appearance} · {t.language} · {t.accountAndWorkspace}
        </p>
      </div>

      <div className="space-y-6">
        {/* Dynamic Material 3 Color Mode (Light / Dark / System) */}
        <section className="p-5 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] space-y-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[var(--md-sys-color-on-surface-variant)]" />
            <h2 className="text-sm font-semibold">{t.colorMode}</h2>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-1">
            <button
              type="button"
              onClick={() => setThemeMode('light')}
              className={`p-3 rounded-2xl border text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                themeMode === 'light'
                  ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] border-[var(--md-sys-color-outline)] font-semibold'
                  : 'bg-[var(--md-sys-color-surface-container-low)] border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]'
              }`}
            >
              <Sun className="w-4 h-4" />
              <span>{t.light}</span>
            </button>

            <button
              type="button"
              onClick={() => setThemeMode('dark')}
              className={`p-3 rounded-2xl border text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                themeMode === 'dark'
                  ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] border-[var(--md-sys-color-outline)] font-semibold'
                  : 'bg-[var(--md-sys-color-surface-container-low)] border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]'
              }`}
            >
              <Moon className="w-4 h-4" />
              <span>{t.dark}</span>
            </button>

            <button
              type="button"
              onClick={() => setThemeMode('system')}
              className={`p-3 rounded-2xl border text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                themeMode === 'system'
                  ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] border-[var(--md-sys-color-outline)] font-semibold'
                  : 'bg-[var(--md-sys-color-surface-container-low)] border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]'
              }`}
            >
              <Monitor className="w-4 h-4" />
              <span>{t.system}</span>
            </button>
          </div>
        </section>

        {/* Dynamic Material 3 Seed Color Selector (Full Color Spectrum Picker, NO ready presets) */}
        <section className="p-5 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-[var(--md-sys-color-on-surface-variant)]" />
              <h2 className="text-sm font-semibold">{t.themeColor}</h2>
            </div>
            <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)] border border-[var(--md-sys-color-outline-variant)]">
              Material 3 Dynamic
            </span>
          </div>

          <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] leading-relaxed">
            {t.m3ThemeDesc}
          </p>

          {/* Interactive Native Spectrum Color Picker + Hex Input */}
          <div className="p-4 rounded-2xl bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* Native Full Spectrum Color Swatch */}
                <div className="relative group cursor-pointer shrink-0">
                  <input
                    type="color"
                    value={customPrimaryColor}
                    onChange={handleColorPickerChange}
                    className="w-12 h-12 rounded-2xl cursor-pointer opacity-0 absolute inset-0 z-10"
                    title={t.customColor}
                  />
                  <div
                    className="w-12 h-12 rounded-2xl border-2 border-[var(--md-sys-color-outline)] shadow-xs flex items-center justify-center transition-transform group-hover:scale-105"
                    style={{ backgroundColor: customPrimaryColor }}
                  >
                    <Palette className="w-5 h-5 text-white drop-shadow-sm pointer-events-none" />
                  </div>
                </div>

                <div>
                  <span className="text-xs font-semibold block text-[var(--md-sys-color-on-surface)]">
                    {t.customColor}
                  </span>
                  <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] font-mono">
                    {customPrimaryColor.toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Hex Input and Apply Button */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <span className="absolute left-3 top-2.5 rtl:left-auto rtl:right-3 text-xs font-mono text-[var(--md-sys-color-on-surface-variant)] pointer-events-none">
                    #
                  </span>
                  <input
                    type="text"
                    maxLength={6}
                    value={hexInput}
                    onChange={handleHexChange}
                    placeholder="0F766E"
                    className="w-28 pl-7 pr-3 rtl:pl-3 rtl:pr-7 py-2 rounded-xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline)] text-xs font-mono uppercase text-[var(--md-sys-color-on-surface)] focus:outline-none focus:border-[var(--md-sys-color-primary)]"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleApplyHex}
                  className="px-4 py-2 rounded-xl bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] text-xs font-semibold hover:opacity-90 transition-opacity"
                >
                  {t.apply}
                </button>
              </div>
            </div>

            {/* Generated M3 Tonal Palette Swatches Preview */}
            <div className="pt-3 border-t border-[var(--md-sys-color-outline-variant)] space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] block">
                {isRTL ? 'پالت توکن‌های تولیدی متریال ۳' : 'Synthesized M3 Tonal Tokens'}
              </span>
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2.5 rounded-xl bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] text-center text-[10px] font-mono">
                  Primary
                </div>
                <div className="p-2.5 rounded-xl bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] text-center text-[10px] font-mono">
                  Secondary
                </div>
                <div className="p-2.5 rounded-xl bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] text-center text-[10px] font-mono">
                  Surface
                </div>
                <div className="p-2.5 rounded-xl bg-[var(--md-sys-color-surface-container-lowest)] text-[var(--md-sys-color-on-surface)] text-center text-[10px] font-mono border border-[var(--md-sys-color-outline-variant)]">
                  Background
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Language Selection */}
        <section className="p-5 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[var(--md-sys-color-on-surface-variant)]" />
            <h2 className="text-sm font-semibold">{t.language}</h2>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={() => setLocale('en')}
              className={`p-3 rounded-2xl border text-xs font-medium flex items-center justify-between transition-colors ${
                locale === 'en'
                  ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] border-[var(--md-sys-color-outline)] font-semibold'
                  : 'bg-[var(--md-sys-color-surface-container-low)] border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]'
              }`}
            >
              <span>{t.english}</span>
              {locale === 'en' && <Check className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setLocale('fa')}
              className={`p-3 rounded-2xl border text-xs font-medium flex items-center justify-between transition-colors ${
                locale === 'fa'
                  ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] border-[var(--md-sys-color-outline)] font-semibold'
                  : 'bg-[var(--md-sys-color-surface-container-low)] border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]'
              }`}
            >
              <span>{t.persian}</span>
              {locale === 'fa' && <Check className="w-4 h-4" />}
            </button>
          </div>
        </section>

        {/* Account & Workspace Tier */}
        <section className="p-5 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] space-y-4">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-[var(--md-sys-color-on-surface-variant)]" />
            <h2 className="text-sm font-semibold">{t.accountAndWorkspace}</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-2xl bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] block">
                {t.accountTier}
              </span>
              <p className="text-sm font-semibold text-[var(--md-sys-color-on-surface)]">
                {t.proWorkspace}
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] block">
                {t.monthlyTokens}
              </span>
              <p className="text-sm font-semibold text-[var(--md-sys-color-on-surface)]">
                {account.tokensUsedMillion}M / {account.tokensLimitMillion}M
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] block">
                {t.monthlyRuns}
              </span>
              <p className="text-sm font-semibold text-[var(--md-sys-color-on-surface)]">
                {account.runsUsed.toLocaleString()} / {account.runsLimit.toLocaleString()}
              </p>
            </div>
          </div>
        </section>

        {/* Danger Zone: Reset Workspace */}
        <section className="p-5 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] space-y-3">
          <div className="flex items-center gap-2 text-[var(--md-sys-color-error)]">
            <ShieldAlert className="w-4 h-4" />
            <h2 className="text-sm font-semibold">{t.dangerZone}</h2>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div>
              <p className="text-xs font-medium text-[var(--md-sys-color-on-surface)]">
                {t.resetWorkspace}
              </p>
              <p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] mt-0.5">
                {t.resetConfirm}
              </p>
            </div>

            <button
              type="button"
              onClick={handleResetData}
              className="px-4 py-2 rounded-xl bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] border border-[var(--md-sys-color-error)]/20 text-xs font-semibold hover:opacity-90 transition-opacity flex items-center gap-2 self-start sm:self-auto"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t.resetWorkspace}</span>
            </button>
          </div>
        </section>

        {/* Session */}
        <section className="p-5 rounded-xl bg-[var(--md-sys-color-surface-container-low)] space-y-3">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-[var(--md-sys-color-on-surface-variant)]" />
            <h2 className="text-sm font-semibold">{t.accountAndWorkspace}</h2>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-[var(--md-sys-color-on-surface)] truncate">
                {session?.name}
              </p>
              <p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] truncate">
                {session?.email}
              </p>
            </div>

            <button
              type="button"
              onClick={signOut}
              className="h-9 px-3.5 rounded-lg bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] text-xs font-semibold hover:bg-[var(--md-sys-color-surface-container-highest)] transition-colors flex items-center gap-2 self-start sm:self-auto"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t.authSignOut}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
