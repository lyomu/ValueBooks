import type { SVGProps } from 'react';

/** Google Material Symbols' expand_more icon, kept local to avoid a font request. */
export function MaterialChevronDown(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" {...props}>
      <path d="M7 10l5 5 5-5z" />
    </svg>
  );
}
