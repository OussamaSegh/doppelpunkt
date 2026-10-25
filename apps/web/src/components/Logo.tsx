export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#1c2a4a" />
      <circle cx="256" cy="166" r="66" fill="#d9a21b" />
      <circle cx="256" cy="346" r="66" fill="#d63a2c" />
    </svg>
  );
}
