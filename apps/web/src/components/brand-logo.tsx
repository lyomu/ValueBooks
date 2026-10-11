import Image from 'next/image';

interface BrandLogoProps {
  /**
   * 'full' shows the full logo mark with 'ValueBooks' text.
   * 'mark' shows the icon mark only.
   */
  variant?: 'full' | 'mark';
  className?: string;
  height?: number;
  alt?: string;
  priority?: boolean;
}

export function BrandLogo({
  variant = 'full',
  className,
  height = 32,
  alt = 'ValueBooks',
  priority = false,
}: BrandLogoProps) {
  if (variant === 'mark') {
    // logo-mark aspect ratio: 168 x 166 (~1:1)
    const width = Math.round((height * 168) / 166);
    return (
      <Image
        src="/logo-mark.png"
        alt={alt}
        width={width}
        height={height}
        className={className}
        priority={priority}
        style={{ height: `${height}px`, width: 'auto', display: 'block' }}
      />
    );
  }

  // Full logo aspect ratio: 842 x 166 (~5.07:1)
  const width = Math.round((height * 842) / 166);
  return (
    <Image
      src="/logo-full.png"
      alt={alt}
      width={width}
      height={height}
      className={className}
      priority={priority}
      style={{ height: `${height}px`, width: 'auto', display: 'block' }}
    />
  );
}
