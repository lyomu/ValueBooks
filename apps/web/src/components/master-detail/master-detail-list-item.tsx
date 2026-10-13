import type { ReactNode } from 'react';
import Link from 'next/link';

export function MasterDetailListItem({
  id,
  href,
  selected,
  onSelect,
  onKeyDown,
  children,
}: {
  id: string;
  href: string;
  selected: boolean;
  onSelect: () => void;
  onKeyDown: React.KeyboardEventHandler<HTMLAnchorElement>;
  children: ReactNode;
}) {
  return (
    <Link
      id={id}
      role="option"
      aria-selected={selected}
      className="rb-master-detail__record rb-record-workspace__record"
      data-selected={selected || undefined}
      href={href}
      onClick={(event) => {
        if (href === '#') event.preventDefault();
        onSelect();
      }}
      onKeyDown={onKeyDown}
    >
      {children}
    </Link>
  );
}
