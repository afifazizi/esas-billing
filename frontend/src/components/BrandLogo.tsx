type BrandLogoProps = {
  className?: string;
  imageClassName?: string;
  loading?: 'eager' | 'lazy';
};

export function BrandLogo({ className = '', imageClassName = '', loading = 'lazy' }: BrandLogoProps) {
  const sharedClassName = `h-auto w-full object-contain ${imageClassName}`;

  return (
    <span className={`block ${className}`} aria-label="ESAS Billing">
      <img
        src="/brand/esas-logo-dark-display.png"
        alt="ESAS Billing — Enterprise Storage Archiving System"
        width={1075}
        height={372}
        loading={loading}
        decoding="async"
        className={`hidden dark:block ${sharedClassName}`}
      />
      <img
        src="/brand/esas-logo-light-display.png"
        alt="ESAS Billing — Enterprise Storage Archiving System"
        width={1075}
        height={372}
        loading={loading}
        decoding="async"
        className={`block dark:hidden ${sharedClassName}`}
      />
    </span>
  );
}
