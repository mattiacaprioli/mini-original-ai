// Icone SVG inline: nessuna libreria esterna, ereditano il colore del testo (currentColor).
type IconProps = { size?: number }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

export const ArrowUpIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>
)
export const StopIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" /></svg>
)
export const PaperclipIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}><path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.3-8.3a3.3 3.3 0 0 1 4.7 4.7l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6" /></svg>
)
export const PlusIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>
)
export const CheckIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.2}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
)
export const AlertIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2}><path d="M12 8v5M12 16.5v.5" /><circle cx="12" cy="12" r="9" /></svg>
)
export const CopyIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></svg>
)
export const DocumentIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}><path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" /><path d="M14 3.5V8h4.5" /></svg>
)
export const ArrowDownIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}><path d="M12 5v14M18.5 12.5 12 19l-6.5-6.5" /></svg>
)
export const CloseIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}><path d="M6 6l12 12M18 6 6 18" /></svg>
)
