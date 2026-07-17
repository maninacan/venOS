declare module 'react-simple-maps' {
  import type { ReactNode, SVGProps } from 'react';

  interface ComposableMapProps {
    projection?: string;
    projectionConfig?: Record<string, unknown>;
    width?: number;
    height?: number;
    style?: React.CSSProperties;
    className?: string;
    children?: ReactNode;
  }
  export function ComposableMap(props: ComposableMapProps): JSX.Element;

  interface ZoomableGroupProps {
    center?: [number, number];
    zoom?: number;
    children?: ReactNode;
  }
  export function ZoomableGroup(props: ZoomableGroupProps): JSX.Element;

  interface GeographiesProps {
    geography: string | object;
    children: (args: { geographies: Geography[] }) => ReactNode;
  }
  export function Geographies(props: GeographiesProps): JSX.Element;

  interface Geography {
    rsmKey: string;
    id?: string | number;
    properties: Record<string, unknown>;
    type: string;
    geometry: unknown;
  }

  interface GeographyProps extends SVGProps<SVGPathElement> {
    geography: Geography;
    style?: {
      default?: React.CSSProperties & { fill?: string; stroke?: string; outline?: string };
      hover?: React.CSSProperties & { fill?: string; stroke?: string; outline?: string };
      pressed?: React.CSSProperties & { fill?: string; stroke?: string; outline?: string };
    };
  }
  export function Geography(props: GeographyProps): JSX.Element;

  interface MarkerProps {
    coordinates: [number, number];
    children?: ReactNode;
  }
  export function Marker(props: MarkerProps): JSX.Element;
}
