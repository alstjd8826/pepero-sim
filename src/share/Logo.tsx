import type { SVGProps } from 'react';

/** 로고 마크: 막대에 꽂은 동그란 쿠키를 반쯤 초코에 담근 모양. app/icon.svg 와 같은 그림. */
export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" {...props}>
      <defs>
        <clipPath id="pepero-logo-clip">
          <circle cx="32" cy="24" r="17" />
        </clipPath>
      </defs>
      <g transform="rotate(-18 32 32)">
        <rect x="28.5" y="34" width="7" height="27" rx="3.5" fill="#c98a4b" />
        <circle cx="32" cy="24" r="17" fill="#e2ad6e" />
        <g clipPath="url(#pepero-logo-clip)">
          <path
            d="M10 27 q3.6 -3 7.3 0 t7.3 0 t7.3 0 t7.3 0 t7.3 0 t7.3 0 V48 H10 Z"
            fill="#5a3220"
          />
        </g>
        <path d="M45.2 33 v6.8 a2.4 2.4 0 0 1 -4.8 0 V35.5 Z" fill="#5a3220" />
        <circle cx="25.5" cy="18.5" r="2.4" fill="#a8682f" />
        <circle cx="38.5" cy="18.5" r="2.4" fill="#a8682f" />
        <path d="M28.5 22.5 q3.5 3 7 0" stroke="#a8682f" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M18 14 a17 17 0 0 1 9 -6" stroke="#f2cf9c" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}
