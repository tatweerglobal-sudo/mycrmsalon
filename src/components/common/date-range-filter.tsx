'use client';

import React from 'react';

export interface DateRangeFilterProps {
  preset: string; // 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'this_month' | 'custom'
  startDate: string; // 'YYYY-MM-DD'
  endDate: string; // 'YYYY-MM-DD'
  onPresetChange: (preset: string) => void;
  onCustomDatesChange: (startDate: string, endDate: string) => void;
  showAllOption?: boolean;
  label?: string;
  className?: string;
}

export default function DateRangeFilter({
  preset,
  startDate,
  endDate,
  onPresetChange,
  onCustomDatesChange,
  showAllOption = true,
  label = 'تصفية بالفترة الزمنية:',
  className = '',
}: DateRangeFilterProps) {
  const presets = [
    ...(showAllOption ? [{ id: 'all', label: 'كافة الأوقات' }] : []),
    { id: 'today', label: 'اليوم' },
    { id: 'yesterday', label: 'أمس' },
    { id: '7d', label: 'آخر 7 أيام' },
    { id: '30d', label: 'آخر 30 يوماً' },
    { id: 'this_month', label: 'هذا الشهر' },
    { id: 'custom', label: 'فترة مخصصة (من - إلى) 📅' },
  ];

  return (
    <div className={`space-y-2.5 text-right ${className}`} dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        {label && (
          <span className="text-xs font-black text-slate-700 flex items-center gap-1.5 shrink-0">
            <span>📅</span>
            <span>{label}</span>
          </span>
        )}

        {/* أزرار الفترات الجاهزة - تدفق متجاوب مع تمرير سلس على الشاشات الصغيرة */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100/90 rounded-xl border border-slate-200 overflow-x-auto max-w-full">
          {presets.map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => onPresetChange(btn.id)}
              className={`px-2 sm:px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-bold transition-all shrink-0 ${
                preset === btn.id
                  ? 'bg-rose-800 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* حقول التاريخ المخصص (من / إلى) */}
      {preset === 'custom' && (
        <div className="p-3 bg-rose-50/70 border border-rose-200/90 rounded-xl flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 text-xs animate-fade-in shadow-2xs">
          <span className="font-bold text-rose-900 flex items-center gap-1 shrink-0">
            <span>🗓️</span>
            <span>حدد النطاق الزمني:</span>
          </span>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 flex-1">
            <div className="flex items-center justify-between sm:justify-start gap-1.5 flex-1">
              <label className="font-bold text-slate-700 shrink-0">من تاريخ:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => onCustomDatesChange(e.target.value, endDate)}
                className="w-full sm:w-auto px-2.5 py-1.5 bg-white border border-rose-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 font-sans"
              />
            </div>

            <div className="flex items-center justify-between sm:justify-start gap-1.5 flex-1">
              <label className="font-bold text-slate-700 shrink-0">إلى تاريخ:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => onCustomDatesChange(startDate, e.target.value)}
                className="w-full sm:w-auto px-2.5 py-1.5 bg-white border border-rose-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 font-sans"
              />
            </div>
          </div>

          {(startDate || endDate) && (
            <button
              type="button"
              onClick={() => onCustomDatesChange('', '')}
              className="text-xs text-rose-600 hover:text-rose-800 font-bold px-2 py-1 hover:bg-rose-50 rounded-lg transition-colors self-end sm:self-auto sm:mr-auto"
            >
              ✕ مسح التواريخ
            </button>
          )}
        </div>
      )}
    </div>
  );
}
