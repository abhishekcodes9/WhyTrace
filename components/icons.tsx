import type { SVGProps } from "react";

/** GitHub mark (brand icons are no longer part of the Lucide set). */
export function GithubLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .7a11.3 11.3 0 0 0-3.57 22.02c.57.1.78-.25.78-.55v-2.14c-3.17.69-3.84-1.34-3.84-1.34-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.33.95.1-.74.4-1.24.73-1.53-2.53-.29-5.19-1.27-5.19-5.63 0-1.24.44-2.26 1.17-3.05-.12-.29-.51-1.45.11-3.02 0 0 .95-.3 3.12 1.17a10.8 10.8 0 0 1 5.68 0c2.17-1.47 3.12-1.17 3.12-1.17.62 1.57.23 2.73.11 3.02.73.79 1.17 1.81 1.17 3.05 0 4.38-2.67 5.34-5.21 5.62.41.36.78 1.06.78 2.14v3.18c0 .3.2.66.79.55A11.3 11.3 0 0 0 12 .7Z" />
    </svg>
  );
}

export function RedThreadMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 40 20" fill="none" aria-hidden="true" {...props}>
      <path d="M3 14 Q 12 4 20 11 T 37 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="3" cy="14" r="2" fill="currentColor" />
      <circle cx="37" cy="7" r="2" fill="currentColor" />
    </svg>
  );
}
