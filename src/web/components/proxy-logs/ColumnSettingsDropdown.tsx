import React, { useEffect, useRef, useState } from "react";

export interface ColumnSettingOption {
  key: string;
  label: string;
}

interface ColumnSettingsDropdownProps {
  columns: ColumnSettingOption[];
  hiddenColumns: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

export default function ColumnSettingsDropdown({
  columns,
  hiddenColumns,
  onToggle,
}: ColumnSettingsDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutside = (event: MouseEvent) => {
      if (
        containerRef.current
        && !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div className="relative" ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ padding: "6px 10px", fontSize: 12 }}
        title="列设置"
        onClick={() => setOpen((current) => !current)}
      >
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
        </svg>
        <span>列设置</span>
      </button>
      {open && (
        <div className="usage-column-dropdown">
          {columns.map((column) => (
            <button
              key={column.key}
              type="button"
              className="usage-column-dropdown-item"
              onClick={() => onToggle(column.key)}
            >
              <span>{column.label}</span>
              {!hiddenColumns.has(column.key) && (
                <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="var(--color-primary)" strokeWidth={2.4}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
