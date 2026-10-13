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
    // The supplied sidebar icon is cropped to its 374 x 374 artwork bounds.
    const width = Math.round((height * 374) / 374);
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

  // Full logo aspect ratio: dark-surface asset is tightly cropped to 1797 x 363.
  const width =
    tone === 'inverse' ? Math.round((height * 1797) / 363) : Math.round((height * 842) / 166);
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
