import Image from 'next/image';

interface BrandLogoProps {
  /**
   * 'full' shows the full logo mark with 'ValueBooks' text.
   * 'mark' shows the icon mark only.
   */
  variant?: 'full' | 'mark';
  /** Selects the white wordmark for dark backgrounds; the blue mark stays unchanged. */
  tone?: 'default' | 'inverse';
  className?: string;
  height?: number;
  alt?: string;
  priority?: boolean;
}

export function BrandLogo({
  variant = 'full',
  tone = 'default',
  className,
  height = 32,
  alt = 'ValueBooks',
  priority = false,
}: BrandLogoProps) {
  if (variant === 'mark') {
    const width = height;
    return (
      <Image
        src="/logo-mark-sidebar.png"
        alt={alt}
        width={width}
        height={height}
        className={className}
        priority={priority}
        style={{ height: `${height}px`, width: 'auto', display: 'block' }}
      />
    );
  }

  // Both full-logo files share the same 1200 x 238 crop; only the wordmark colour differs.
  const width = Math.round((height * 1200) / 238);
  return (
    <Image
      src={tone === 'inverse' ? '/logo-full-white.png' : '/logo-full.png'}
      alt={alt}
      width={width}
      height={height}
      className={className}
      priority={priority}
      style={{ height: `${height}px`, width: 'auto', display: 'block' }}
    />
  );
}
