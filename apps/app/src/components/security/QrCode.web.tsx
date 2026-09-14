/**
 * Web: a plain <img>. React Native Web's Image never drew the roughly 25 KB SVG data address a TOTP
 * QR code needs, while the browser loads the same address directly. The CSP allows data: images.
 */
export function QrCode({ svg, size }: { svg: string; size: number }) {
  return <img alt="QR code for your authenticator app" src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} width={size} height={size} />;
}
