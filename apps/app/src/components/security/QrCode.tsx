import { Image } from "react-native";

/** The authenticator QR code, drawn from the server's SVG. Native apps use React Native's Image. */
export function QrCode({ svg, size }: { svg: string; size: number }) {
  return (
    <Image
      accessibilityLabel="QR code for your authenticator app"
      source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` }}
      style={{ width: size, height: size }}
    />
  );
}
