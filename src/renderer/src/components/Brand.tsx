import type { SVGProps } from 'react'

export function LemonMark({ size = 40, ...props }: SVGProps<SVGSVGElement> & { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <rect x="2.5" y="2.5" width="59" height="59" rx="16" fill="#DFF3A6" stroke="#F2C318" strokeWidth="3" />
      <path
        d="M20.5 34.2c0-8.2 5.8-13.6 12.9-13.6 7.3 0 12.9 5.7 12.9 13.6 0 8.1-5.6 13.7-13 13.7-7.2 0-12.8-5.5-12.8-13.7Z"
        fill="#FAD642"
        stroke="#1B1B18"
        strokeWidth="2.2"
      />
      <path d="m21 33-5 1.5 5 1.5M45.8 33l5 1.5-5 1.5" fill="#FAD642" stroke="#1B1B18" strokeWidth="2" />
      <circle cx="33.4" cy="34" r="8" stroke="#FFF9D2" strokeWidth="1.8" />
      <path
        d="M33.4 34l6.3-5.5M33.4 34l7.5 3.2M33.4 34l-.2 8.2M33.4 34l-6.8 5.3M33.4 34l-8-1"
        stroke="#FFF9D2"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M28.4 22.2c1.3-3.5 4.8-4.7 7.2-3.2 1.8-2.6 5.9-2.1 7 1 2.3 1 2.3 4-.2 5.1-3.2 1.4-9.3.8-12.2-2.2Z"
        fill="#7DB530"
        stroke="#1B1B18"
        strokeWidth="1.8"
      />
      <path d="m49 48 1.1 2.5 2.4.3-1.8 1.7.4 2.5-2.1-1.3-2.2 1.3.4-2.5-1.8-1.7 2.5-.3L49 48Z" fill="#E2463D" />
    </svg>
  )
}

export function Logo({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return (
    <div className="logo">
      <LemonMark size={compact ? 32 : 40} />
      {!compact && (
        <div className="logo-type">
          <span className="logo-word">LemoNotes</span>
          <span className="logo-tagline">ideas con zumo</span>
        </div>
      )}
    </div>
  )
}

export function LemonHeroArt(): React.JSX.Element {
  return (
    <svg className="hero-art" viewBox="0 0 440 320" fill="none" role="img" aria-label="Un limón con una libreta">
      <path
        d="M42 266c67-34 129-24 167-1 43 27 99 20 135-13 24-22 49-31 72-22"
        stroke="#F2C318"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="1 11"
      />
      <circle cx="329" cy="74" r="42" fill="#F2C318" opacity=".2" />
      <circle cx="83" cy="92" r="22" fill="#E2463D" opacity=".13" />
      <path
        d="M175 146c1-58 43-95 96-95 55 0 97 39 98 95 1 59-42 98-98 98-55 0-96-40-96-98Z"
        fill="#FAE07A"
        stroke="#1B1B18"
        strokeWidth="5"
      />
      <path d="m176 139-39 8 39 10M369 139l39 8-39 10" fill="#FAE07A" stroke="#1B1B18" strokeWidth="4" />
      <circle cx="271" cy="146" r="61" stroke="#FFF9D2" strokeWidth="4" />
      <path
        d="M271 146l49-43M271 146l58 25M271 146l-2 62M271 146l-51 41M271 146l-62-6M271 146l-48-45M271 146l-22-59"
        stroke="#FFF9D2"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="271" cy="146" r="7" fill="#FFF9D2" />
      <path
        d="M231 111c5-25 26-34 42-25 10-17 37-16 44 5 16 6 17 25 2 32-19 10-57 8-88-12Z"
        fill="#8BC53F"
        stroke="#1B1B18"
        strokeWidth="4"
      />
      <g transform="rotate(5 306 242)">
        <rect x="247" y="201" width="152" height="112" rx="18" fill="#E2463D" stroke="#1B1B18" strokeWidth="5" />
        <circle cx="276" cy="229" r="9" fill="#7C46DB" stroke="#1B1B18" strokeWidth="2" />
        <path d="M296 229h70M296 248h53M296 267h63M296 286h41" stroke="#FFF9E7" strokeWidth="5" strokeLinecap="round" />
      </g>
      <g fill="#1B1B18">
        <circle cx="397" cy="182" r="5" opacity=".5" />
        <circle cx="57" cy="228" r="4" opacity=".35" />
      </g>
    </svg>
  )
}
