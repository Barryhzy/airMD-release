import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

export const IconOutline = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M9.5 2.5v11M11.5 5h.5M11.5 8h.5M11.5 11h.5" />
  </Icon>
);

export const IconSidebar = (p: IconProps) => (
  <Icon {...p}><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M6 2.5v11" /></Icon>
);
export const IconRefresh = (p: IconProps) => (
  <Icon {...p}><path d="M13 6A5.2 5.2 0 1 0 13 10M13 2.5V6H9.5" /></Icon>
);
export const IconClose = (p: IconProps) => (
  <Icon {...p}><path d="m4 4 8 8M12 4l-8 8" /></Icon>
);

function Icon({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconBold = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 2.5h4a3 3 0 0 1 0 6h-4z" strokeWidth={1.7} />
    <path d="M4.5 8.5h4.6a2.75 2.75 0 0 1 0 5.5H4.5z" strokeWidth={1.7} />
  </Icon>
);

export const IconItalic = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 2.5H6.75M9.25 13.5H6.5M9.5 2.5 6.5 13.5" strokeWidth={1.6} />
  </Icon>
);

export const IconStrike = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8h10" />
    <path d="M11 4.6C10.4 3.6 9.3 3 8 3 6.3 3 5 3.9 5 5.2c0 1 .7 1.6 2 2" />
    <path d="M5 11.4C5.7 12.4 6.8 13 8 13c1.7 0 3-.9 3-2.2 0-.7-.3-1.2-.9-1.6" />
  </Icon>
);

export const IconCode = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 4.5 2.5 8 6 11.5M10 4.5 13.5 8 10 11.5" />
  </Icon>
);

export const IconLink = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l1.9-1.9a2.6 2.6 0 1 0-3.7-3.7l-1 1" />
    <path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0l-1.9 1.9a2.6 2.6 0 1 0 3.7 3.7l1-1" />
  </Icon>
);

export const IconBulletList = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="3.2" cy="4.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.2" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.2" cy="11.5" r="1" fill="currentColor" stroke="none" />
    <path d="M6.3 4.5h7M6.3 8h7M6.3 11.5h7" />
  </Icon>
);

export const IconOrderedList = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.4 3.2h1v2.4M2.2 5.6h1.9" strokeWidth={1.1} />
    <path d="M2.3 9.1c0-.5.4-.9.9-.9s.9.3.9.8c0 .7-1.8 1.5-1.8 2.4h1.9" strokeWidth={1.1} />
    <path d="M6.6 4.4h7M6.6 8h7M6.6 11.6h7" />
  </Icon>
);

export const IconTodo = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.2" y="2.2" width="4.4" height="4.4" rx="1" />
    <path d="m3.3 4.4.9.9 1.6-1.7" />
    <path d="M9 4.4h4.8" />
    <path d="M9 9.1h4.8" />
    <rect x="2.2" y="8.6" width="4.4" height="4.4" rx="1" />
  </Icon>
);

export const IconQuote = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 3.4v9.2" />
    <path d="M6.2 4.6h6.6M6.2 8h6.6M6.2 11.4h4.4" />
  </Icon>
);

export const IconCodeBlock = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6.4 6.5 5 8l1.4 1.5M9.6 6.5 11 8l-1.4 1.5" strokeWidth={1.2} />
  </Icon>
);

export const IconTable = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.2" y="3" width="11.6" height="10" rx="1.4" />
    <path d="M2.2 6.4h11.6M6.2 6.4V13M10.2 6.4V13" strokeWidth={1.2} />
  </Icon>
);

export const IconImage = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1.6" />
    <circle cx="5.8" cy="6.4" r="1.1" />
    <path d="m3 11.6 3.2-3.1 2.3 2.2 1.9-1.9L14 11.6" />
  </Icon>
);

export const IconDivider = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 8h11" />
    <path d="M4 4.6h8M4 11.4h8" opacity=".35" />
  </Icon>
);

export const IconUndo = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.2 6.2H9a3.4 3.4 0 1 1 0 6.8H6.4" />
    <path d="m6.4 3.6-2.4 2.6 2.4 2.4" />
  </Icon>
);

export const IconRedo = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11.8 6.2H7a3.4 3.4 0 1 0 0 6.8h2.6" />
    <path d="m9.6 3.6 2.4 2.6-2.4 2.4" />
  </Icon>
);

export const IconSun = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2.9" />
    <path d="M8 1.6v1.3M8 13.1v1.3M1.6 8h1.3M13.1 8h1.3M3.5 3.5l.9.9M11.6 11.6l.9.9M12.5 3.5l-.9.9M4.4 11.6l-.9.9" strokeWidth={1.2} />
  </Icon>
);

export const IconMoon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 9.6A5.6 5.6 0 0 1 6.4 3 5.6 5.6 0 1 0 13 9.6Z" />
  </Icon>
);

export const IconSave = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 2.5h7.2L13 5.3V13a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 13z" />
    <path d="M5.4 2.5v3.2h4.4V2.5M5.2 13.5V9.2h5.6v4.3" strokeWidth={1.2} />
  </Icon>
);

export const IconFolder = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 4.3c0-.6.4-1 1-1h3l1.4 1.6H13c.6 0 1 .4 1 1v6.3c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" />
  </Icon>
);

export const IconFile = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.6 2.5h5.2L12.4 6v7.5c0 .3-.2.5-.5.5H3.6a.5.5 0 0 1-.5-.5v-11c0-.3.2-.5.5-.5Z" />
    <path d="M8.6 2.6V6h3.6" strokeWidth={1.2} />
  </Icon>
);

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3.5v9M3.5 8h9" strokeWidth={1.6} />
  </Icon>
);

export const IconDotsSix = (p: IconProps) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <circle cx="6" cy="4" r="1.15" />
    <circle cx="6" cy="8" r="1.15" />
    <circle cx="6" cy="12" r="1.15" />
    <circle cx="10" cy="4" r="1.15" />
    <circle cx="10" cy="8" r="1.15" />
    <circle cx="10" cy="12" r="1.15" />
  </svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4.5 6.5 3.5 3.5 3.5-3.5" strokeWidth={1.4} />
  </Icon>
);

export const IconWarning = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.6 14 13H2z" />
    <path d="M8 6.4v3.1" />
    <circle cx="8" cy="11.4" r=".75" fill="currentColor" stroke="none" />
  </Icon>
);

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3.4 8.4 3 3 6.2-6.6" strokeWidth={1.7} />
  </Icon>
);

export const IconSource = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.4 4.2 2 8l3.4 3.8M10.6 4.2 14 8l-3.4 3.8" />
    <path d="M9.2 2.4 6.8 13.6" strokeWidth={1.2} />
  </Icon>
);

export const IconEye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.6 8S4.2 3.8 8 3.8 14.4 8 14.4 8 11.8 12.2 8 12.2 1.6 8 1.6 8Z" />
    <circle cx="8" cy="8" r="1.9" />
  </Icon>
);

export const IconMinus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 8h9" />
  </Icon>
);

export const IconMore = (p: IconProps) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <circle cx="3.5" cy="8" r="1.15" />
    <circle cx="8" cy="8" r="1.15" />
    <circle cx="12.5" cy="8" r="1.15" />
  </svg>
);
