'use client';

import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

/**
 * Site-wide scroll-entrance system for the public marketing pages. Hidden-until-revealed state is
 * only ever applied client-side after this component mounts, so content already in the server
 * render is fully visible with JavaScript disabled or before hydration completes. Not for
 * above-the-fold hero content: use the CSS-only `animation` entrances in marketing.css instead, so
 * the LCP element never depends on JavaScript or risks a visible-then-hidden flash.
 */

type RevealVariant = 'up' | 'scale';

export function Reveal({
  as = 'div',
  variant = 'up',
  delay = 0,
  className = '',
  children,
  style,
  ...rest
}: {
  as?: ElementType;
  variant?: RevealVariant;
  delay?: number;
  className?: string;
  children: ReactNode;
  style?: Record<string, unknown>;
  [key: string]: unknown;
}) {
  const Tag = as as 'div';
  const appliedStyle = style;
  const forwardedProps = rest;
  const ref = useRef<HTMLElement | null>(null);
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    setPending(true);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const classes = [
    'mk-reveal',
    `mk-reveal--${variant}`,
    pending && !visible ? 'is-pending' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag
      ref={ref as never}
      className={classes}
      style={delay ? { ...appliedStyle, transitionDelay: `${delay}ms` } : appliedStyle}
      {...forwardedProps}
    >
      {children}
    </Tag>
  );
}
